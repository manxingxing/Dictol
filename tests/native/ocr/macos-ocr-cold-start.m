// Manual diagnostic: run the production Vision implementation without Node/Electron.
// Input is synthetic; the first and second calls show cold versus warm load cost.
#import "ocr.h"
#import <Foundation/Foundation.h>
#import <CoreText/CoreText.h>
#include <stdio.h>
#include <unistd.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        const char *languages = argc > 1 ? argv[1] : "zh-Hans,en-US,ja-JP,zh-Hant";
        CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
        CGContextRef context = CGBitmapContextCreate(NULL, 1400, 600, 8, 1400 * 4, space,
            kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
        CGColorSpaceRelease(space);
        if (!context) return 1;
        CGContextSetRGBFillColor(context, 1, 1, 1, 1);
        CGContextFillRect(context, CGRectMake(0, 0, 1400, 600));
        CTFontRef font = CTFontCreateWithName(CFSTR("Arial"), 48, NULL);
        NSAttributedString *text = [[NSAttributedString alloc]
            initWithString:@"Hello Dictol 中文识别 日本語のテスト"
            attributes:@{(__bridge NSString *)kCTFontAttributeName: (__bridge id)font}];
        CTLineRef line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)text);
        CGContextSetTextPosition(context, 30, 480);
        CTLineDraw(line, context);
        CFRelease(line);
        CFRelease(font);
        CGImageRef image = CGBitmapContextCreateImage(context);
        CGContextRelease(context);
        if (!image) return 1;
        int exit_code = 0;
        for (int pass = 1; pass <= 2; pass++) {
            fprintf(stderr, "[ColdStartProbe] time=%.3f pid=%d pass=%d languages=%s begin\n",
                CFAbsoluteTimeGetCurrent() + kCFAbsoluteTimeIntervalSince1970, getpid(), pass, languages);
            uint8_t *json = NULL;
            size_t length = 0;
            int success = recognize_image(image, languages, &json, &length);
            NSError *error = nil;
            NSDictionary *result = success && json ? [NSJSONSerialization JSONObjectWithData:
                [NSData dataWithBytes:json length:length] options:0 error:&error] : nil;
            free_ocr_json(json);
            fprintf(stderr, "[ColdStartProbe] pass=%d observations=%lu success=%d\n", pass,
                (unsigned long)[result[@"observations"] count], result && !result[@"error"] && !error);
            if (!result || result[@"error"] || error) exit_code = 1;
        }
        CGImageRelease(image);
        return exit_code;
    }
}
