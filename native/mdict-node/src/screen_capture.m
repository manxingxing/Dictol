#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

int dictol_capture_screen_region(double x, double y, double width, double height,
                                 uint8_t **bytes, size_t *length,
                                 size_t *image_width, size_t *image_height) {
  @autoreleasepool {
    if (!bytes || !length || !image_width || !image_height ||
        width <= 0 || height <= 0) return 0;
    *bytes = NULL;
    *length = 0;
    NSOperatingSystemVersion version = [[NSProcessInfo processInfo] operatingSystemVersion];
    if (version.majorVersion < 15 ||
        (version.majorVersion == 15 && version.minorVersion < 2)) return 0;
    // Capture completes asynchronously on ScreenCaptureKit's callback queue;
    // this bridge is called from a Rust worker, so it waits for the image here.
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block CGImageRef captured = NULL;
    [SCScreenshotManager captureImageInRect:CGRectMake(x, y, width, height)
                            completionHandler:^(CGImageRef image, NSError *error) {
      if (image && !error) captured = CGImageRetain(image);
      dispatch_semaphore_signal(done);
    }];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    if (!captured) return 0;

    // Encode while CGImageRef is retained, then transfer a malloc-owned copy
    // across the C ABI for Rust to release after copying it into N-API memory.
    NSMutableData *png = [NSMutableData data];
    CGImageDestinationRef destination = CGImageDestinationCreateWithData(
        (__bridge CFMutableDataRef)png, CFSTR("public.png"), 1, NULL);
    if (!destination) {
      CGImageRelease(captured);
      return 0;
    }
    CGImageDestinationAddImage(destination, captured, NULL);
    BOOL encoded = CGImageDestinationFinalize(destination);
    CFRelease(destination);
    if (!encoded || png.length == 0) {
      CGImageRelease(captured);
      return 0;
    }

    uint8_t *copy = malloc(png.length);
    if (!copy) {
      CGImageRelease(captured);
      return 0;
    }
    memcpy(copy, png.bytes, png.length);
    *bytes = copy;
    *length = png.length;
    *image_width = CGImageGetWidth(captured);
    *image_height = CGImageGetHeight(captured);
    CGImageRelease(captured);
    return 1;
  }
}

void dictol_free_screen_region(uint8_t *bytes) {
  free(bytes);
}
