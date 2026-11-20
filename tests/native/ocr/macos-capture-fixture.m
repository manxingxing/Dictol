// Link the production Node binding against an owned image, without TCC or a display.
#import "capture.h"
NSArray *list_displays(NSError **error) {
    return @[@{@"id": @101, @"bounds": @{@"x": @0, @"y": @0, @"width": @200, @"height": @100}}];
}
NSArray *list_windows(NSError **error) {
    return @[@{@"id": @202, @"title": @"Fixture window", @"windowLayer": @0, @"isOnScreen": @YES,
               @"bounds": @{@"x": @10, @"y": @20, @"width": @160, @"height": @80}}];
}
static CGImageRef make_image(size_t width, size_t height) {
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, width * 4, space,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(space);
    CGContextSetRGBFillColor(context, 1, 1, 1, 1);
    CGContextFillRect(context, CGRectMake(0, 0, width, height));
    CGImageRef image = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
    return image;
}

CGImageRef capture_region(uint32_t display_id, CGRect region, NSError **error) {
    if (display_id == UINT32_MAX) {
        *error = [NSError errorWithDomain:@"FixtureCapture" code:1
            userInfo:@{NSLocalizedDescriptionKey: @"Fixture display was not found"}];
        return NULL;
    }
    return make_image((size_t)round(region.size.width), (size_t)round(region.size.height));
}
CGImageRef capture_display(uint32_t display_id, NSError **error) {
    return make_image(200, 100);
}
CGImageRef capture_window(uint32_t window_id, NSError **error) {
    return make_image(160, 80);
}
