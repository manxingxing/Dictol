#import <Foundation/Foundation.h>

bool dictol_supports_capture_image_in_rect(void) {
    NSOperatingSystemVersion minimum = {15, 2, 0};
    @autoreleasepool {
        return [[NSProcessInfo processInfo] isOperatingSystemAtLeastVersion:minimum];
    }
}
