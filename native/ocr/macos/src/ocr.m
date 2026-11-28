#import "ocr.h"
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// 将 Foundation 的临时 JSON 数据复制到调用方拥有的缓冲区，避免跨 autoreleasepool 借用。
static int copy_json(id value, uint8_t **output, size_t *output_length) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    if (!json) return 0;
    uint8_t *bytes = malloc(json.length);
    if (!bytes) return 0;
    memcpy(bytes, json.bytes, json.length);
    *output = bytes;
    *output_length = json.length;
    return 1;
}

// 保留 Vision 的左下角原点归一化矩形；上层 ocr-text.ts 会转换为屏幕坐标。
static NSDictionary *rect_json(CGRect rect) {
    return @{
        @"x": @(rect.origin.x), @"y": @(rect.origin.y),
        @"width": @(rect.size.width), @"height": @(rect.size.height)
    };
}

// 四角坐标采用左上角原点，与矩形字段的约定不同，供旋转文字高亮直接使用。
static NSDictionary *top_left_point_json(CGPoint point) {
    return @{@"x": @(point.x), @"y": @(1 - point.y)};
}

// 对截图或 PNG 解码后的图像执行 Vision 识别；这里只借用调用方的图像。
int recognize_image(CGImageRef image, const char *language_list, OcrRecognitionMode mode,
                    uint8_t **output, size_t *output_length) {
    if (!image || !language_list || !output || !output_length) return 0;
    *output = NULL;
    *output_length = 0;

    NSMutableArray<NSString *> *languages = [NSMutableArray array];
    NSString *list = [NSString stringWithUTF8String:language_list];
    for (NSString *part in [list componentsSeparatedByString:@","]) {
        NSString *language = [part stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        if (language.length) [languages addObject:language];
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = mode == OcrRecognitionFast
        ? VNRequestTextRecognitionLevelFast : VNRequestTextRecognitionLevelAccurate;
    request.recognitionLanguages = languages;
    request.automaticallyDetectsLanguage = YES;
    request.usesLanguageCorrection = YES;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    NSError *error = nil;
    BOOL recognized = [handler performRequests:@[request] error:&error];
    if (!recognized) {
        return copy_json(@{@"error": error.localizedDescription ?: @"Vision OCR 识别失败"},
                         output, output_length);
    }

    NSMutableArray *observations = [NSMutableArray array];
    for (VNRecognizedTextObservation *observation in request.results) {
        VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
        if (!candidate || !candidate.string.length) continue;
        NSString *text = candidate.string;
        NSMutableArray *characters = [NSMutableArray array];
        // 按组合字符遍历，避免拆开代理对或组合附加符；范围使用 NSString/JS 的 UTF-16 单元。
        for (NSUInteger offset = 0; offset < text.length;) {
            NSRange range = [text rangeOfComposedCharacterSequenceAtIndex:offset];
            VNRectangleObservation *box = [candidate boundingBoxForRange:range error:NULL];
            if (box) {
                NSMutableDictionary *character = [rect_json(box.boundingBox) mutableCopy];
                character[@"start"] = @(range.location);
                character[@"length"] = @(range.length);
                // 四角统一按左上、右上、右下、左下输出。
                character[@"quad"] = @[
                    top_left_point_json(box.topLeft),
                    top_left_point_json(box.topRight),
                    top_left_point_json(box.bottomRight),
                    top_left_point_json(box.bottomLeft)
                ];
                [characters addObject:character];
            }
            offset = NSMaxRange(range);
        }
        NSMutableDictionary *line = [rect_json(observation.boundingBox) mutableCopy];
        line[@"text"] = text;
        line[@"confidence"] = @(candidate.confidence);
        line[@"characters"] = characters;
        line[@"quad"] = @[
            top_left_point_json(observation.topLeft),
            top_left_point_json(observation.topRight),
            top_left_point_json(observation.bottomRight),
            top_left_point_json(observation.bottomLeft)
        ];
        [observations addObject:line];
    }
    return copy_json(@{@"observations": observations}, output, output_length);
}

// PNG 输入只在这里解码；data 借用原始字节，解码得到的 image 则由本函数释放。
int recognize_png(const uint8_t *png, size_t png_length,
                  const char *language_list, OcrRecognitionMode mode,
                  uint8_t **output, size_t *output_length) {
    if (!png || !png_length || !language_list || !output || !output_length) return 0;
    *output = NULL;
    *output_length = 0;
    NSData *data = [NSData dataWithBytesNoCopy:(void *)png length:png_length freeWhenDone:NO];
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
    if (!source) return copy_json(@{@"error": @"无法读取 OCR 截图"}, output, output_length);

    CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    CFRelease(source);
    if (!image) return copy_json(@{@"error": @"无法解码 OCR 截图"}, output, output_length);
    
    int result = recognize_image(image, language_list, mode, output, output_length);
    CGImageRelease(image);
    return result;
}

void free_ocr_json(uint8_t *bytes) {
    free(bytes);
}
