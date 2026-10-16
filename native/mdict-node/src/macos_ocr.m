#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

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

static NSDictionary *rect_json(CGRect rect) {
    return @{
        @"x": @(rect.origin.x), @"y": @(rect.origin.y),
        @"width": @(rect.size.width), @"height": @(rect.size.height)
    };
}

int dictol_recognize_mac_text(const uint8_t *png, size_t png_length,
                             const char *language_list, int accurate,
                             uint8_t **output, size_t *output_length) {
    @autoreleasepool {
        if (!png || !png_length || !language_list || !output || !output_length) return 0;
        *output = NULL;
        *output_length = 0;

        NSData *data = [NSData dataWithBytesNoCopy:(void *)png length:png_length freeWhenDone:NO];
        CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
        if (!source) return copy_json(@{@"error": @"无法读取 OCR 截图"}, output, output_length);
        CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
        CFRelease(source);
        if (!image) return copy_json(@{@"error": @"无法解码 OCR 截图"}, output, output_length);

        NSMutableArray<NSString *> *languages = [NSMutableArray array];
        NSString *list = [NSString stringWithUTF8String:language_list];
        for (NSString *part in [list componentsSeparatedByString:@","]) {
            NSString *language = [part stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
            if (language.length) [languages addObject:language];
        }
        VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
        request.recognitionLevel = accurate ? VNRequestTextRecognitionLevelAccurate
                                            : VNRequestTextRecognitionLevelFast;
        request.recognitionLanguages = languages;
        if (@available(macOS 13.0, *)) request.automaticallyDetectsLanguage = YES;
        request.usesLanguageCorrection = YES;
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
        NSError *error = nil;
        BOOL recognized = [handler performRequests:@[request] error:&error];
        CGImageRelease(image);
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
            for (NSUInteger offset = 0; offset < text.length;) {
                NSRange range = [text rangeOfComposedCharacterSequenceAtIndex:offset];
                VNRectangleObservation *box = [candidate boundingBoxForRange:range error:NULL];
                if (box) {
                    NSMutableDictionary *character = [rect_json(box.boundingBox) mutableCopy];
                    character[@"start"] = @(range.location);
                    character[@"length"] = @(range.length);
                    [characters addObject:character];
                }
                offset = NSMaxRange(range);
            }
            NSMutableDictionary *line = [rect_json(observation.boundingBox) mutableCopy];
            line[@"text"] = text;
            line[@"confidence"] = @(candidate.confidence);
            line[@"characters"] = characters;
            [observations addObject:line];
        }
        return copy_json(@{@"observations": observations}, output, output_length);
    }
}

void dictol_free_mac_ocr_json(uint8_t *bytes) {
    free(bytes);
}
