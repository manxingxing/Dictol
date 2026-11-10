#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

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
