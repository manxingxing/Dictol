#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#include <stdlib.h>
#include <string.h>

// 全局矩形截图接口从 macOS 15.2 开始提供。
bool dictol_supports_capture_image_in_rect(void) {
    NSOperatingSystemVersion minimum = {15, 2, 0};
    @autoreleasepool {
        return [[NSProcessInfo processInfo] isOperatingSystemAtLeastVersion:minimum];
    }
}

// SCScreenshotManager 的过滤器截图接口从 macOS 14 开始提供。
bool dictol_supports_screenshot_manager(void) {
    NSOperatingSystemVersion minimum = {14, 0, 0};
    @autoreleasepool {
        return [[NSProcessInfo processInfo] isOperatingSystemAtLeastVersion:minimum];
    }
}

// 根据当前显示模式计算点到像素的比例；无法获取模式时返回 0。
double dictol_display_scale(uint32_t display_id) {
    CGDisplayModeRef mode = CGDisplayCopyDisplayMode(display_id);
    if (!mode) return 0;
    size_t width = CGDisplayModeGetWidth(mode);
    size_t pixel_width = CGDisplayModeGetPixelWidth(mode);
    CGDisplayModeRelease(mode);
    return width ? (double)pixel_width / (double)width : 0;
}

// Create an owned immutable image before the stream's pixel buffer is unlocked.
CGImageRef dictol_image_from_rgba(const uint8_t *pixels, size_t width, size_t height) {
    CGColorSpaceRef color_space = CGColorSpaceCreateDeviceRGB();
    if (!color_space) return NULL;
    CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, width * 4,
                                                color_space, kCGImageAlphaPremultipliedLast |
                                                kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(color_space);
    if (!context) return NULL;
    memcpy(CGBitmapContextGetData(context), pixels, width * height * 4);
    CGImageRef image = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
    return image;
}

// Encode directly from CGImage so full-screen captures do not need a second RGBA bitmap.
bool dictol_encode_image_png(CGImageRef image, uint8_t **output, size_t *output_length) {
    @autoreleasepool {
        *output = NULL;
        *output_length = 0;
        CFMutableDataRef data = CFDataCreateMutable(kCFAllocatorDefault, 0);
        if (!data) return false;
        CGImageDestinationRef destination = CGImageDestinationCreateWithData(data, CFSTR("public.png"), 1, NULL);
        if (!destination) {
            CFRelease(data);
            return false;
        }
        CGImageDestinationAddImage(destination, image, NULL);
        bool success = CGImageDestinationFinalize(destination);
        CFRelease(destination);
        CFIndex length = CFDataGetLength(data);
        if (!success || length <= 0) {
            CFRelease(data);
            return false;
        }
        uint8_t *bytes = malloc((size_t)length);
        if (!bytes) {
            CFRelease(data);
            return false;
        }
        memcpy(bytes, CFDataGetBytePtr(data), (size_t)length);
        CFRelease(data);
        *output = bytes;
        *output_length = (size_t)length;
        return true;
    }
}

void dictol_free_image_png(uint8_t *bytes) {
    free(bytes);
}
