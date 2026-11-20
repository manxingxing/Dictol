#import "capture.h"
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreImage/CoreImage.h>

// 同步入口由绑定层 execute 的释放池覆盖；独立队列上的样本回调需自行管理释放池。

static NSError *capture_error(NSString *message) {
    return [NSError errorWithDomain:@"DictolCapture" code:1
                          userInfo:@{NSLocalizedDescriptionKey: message}];
}

// 每个异步阶段最多等待 5 秒；超时只结束本地等待，不会取消系统已收到的请求。
static BOOL wait_for(dispatch_semaphore_t semaphore, NSError **error) {
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC))) {
        *error = capture_error(@"ScreenCaptureKit operation timed out");
        return NO;
    }
    return YES;
}

// 将系统回调转为工作线程可顺序使用的结果；回调持有的 __block 对象可安全晚于超时返回。
// 两个参数都只筛选枚举结果中的窗口，不控制后续整屏截图的内容。
static SCShareableContent *get_shareable_content(BOOL exclude_desktop_windows,
                                               BOOL on_screen_windows_only, NSError **error) {
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block SCShareableContent *result;
    __block NSError *failure;
    [SCShareableContent getShareableContentExcludingDesktopWindows:exclude_desktop_windows
                                          onScreenWindowsOnly:on_screen_windows_only
        completionHandler:^(SCShareableContent *value, NSError *err) {
            result = value;
            failure = err;
            dispatch_semaphore_signal(semaphore);
        }];
    if (!wait_for(semaphore, error)) return nil;
    if (!result) *error = failure ?: capture_error(@"Could not retrieve shareable content");
    return result;
}

static NSDictionary *bounds(CGRect rect) {
    return @{ @"x": @(rect.origin.x), @"y": @(rect.origin.y),
              @"width": @(rect.size.width), @"height": @(rect.size.height) };
}

static double overlap(CGRect a, CGRect b) {
    CGRect rect = CGRectIntersection(a, b);
    return CGRectIsNull(rect) ? 0 : rect.size.width * rect.size.height;
}

// 只组装显示器信息；返回的是本次调用的目标快照，不缓存系统对象。
NSArray *list_displays(NSError **error) {
    SCShareableContent *items = get_shareable_content(NO, NO, error);
    if (!items) return nil;
    NSMutableArray *result = [NSMutableArray array];
    for (SCDisplay *display in items.displays) {
        [result addObject:@{@"id": @(display.displayID), @"bounds": bounds(display.frame)}];
    }
    return result;
}

// 展示窗口列表时排除桌面类窗口，仅保留屏幕上与显示器相交的候选。
NSArray *list_windows(NSError **error) {
    SCShareableContent *items = get_shareable_content(YES, YES, error);
    if (!items) return nil;
    NSMutableArray *result = [NSMutableArray array];
    for (SCWindow *window in items.windows) {
        BOOL intersects = NO;
        for (SCDisplay *display in items.displays) {
            if (overlap(display.frame, window.frame) > 0) { intersects = YES; break; }
        }
        if (!intersects) continue;

        NSMutableDictionary *item = [@{@"id": @(window.windowID), @"bounds": bounds(window.frame),
            @"windowLayer": @(window.windowLayer), @"isOnScreen": @(window.onScreen)} mutableCopy];
        if (window.title) item[@"title"] = window.title;
        SCRunningApplication *app = window.owningApplication;
        if (app) item[@"application"] = @{@"processId": @(app.processID),
            @"name": app.applicationName ?: @"", @"bundleIdentifier": app.bundleIdentifier ?: @""};
        [result addObject:item];
    }
    return result;
}

static SCDisplay *find_display(SCShareableContent *items, uint32_t display_id, NSError **error) {
    for (SCDisplay *display in items.displays) {
        if (display.displayID == display_id) return display;
    }
    *error = capture_error(@"ScreenCaptureKit display was not found");
    return nil;
}

// macOS 13 的单帧接收器：仅保留首个完整帧或错误。
// 样本回调、流错误及等待线程通过同一把锁竞争完成权，后到的事件不能覆盖结果。
@interface DictolFrame : NSObject <SCStreamOutput, SCStreamDelegate>
@property dispatch_semaphore_t ready;
@property (strong) id image;
@property (strong) NSError *error;
@property BOOL finished;
@end
@implementation DictolFrame
- (instancetype)init {
    if ((self = [super init])) _ready = dispatch_semaphore_create(0);
    return self;
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    @synchronized(self) {
        if (self.finished) return;
        self.finished = YES;
        self.error = error;
        dispatch_semaphore_signal(self.ready);
    }
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
    // 样本队列不共享 Node 工作线程的释放池，及时清理每帧的 Core Image 临时对象。
    @autoreleasepool {
        if (type != SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample)) return;
        NSArray *attachments = (__bridge NSArray *)CMSampleBufferGetSampleAttachmentsArray(sample, NO);
        NSNumber *status = attachments.firstObject[SCStreamFrameInfoStatus];
        if (!status || status.integerValue != SCFrameStatusComplete) return;
        CVPixelBufferRef buffer = CMSampleBufferGetImageBuffer(sample);
        if (!buffer) return;
        @synchronized(self) {
            if (self.finished) return;
            CIImage *input = [CIImage imageWithCVPixelBuffer:buffer];
            CIContext *context = [CIContext contextWithOptions:nil];
            // 生成可独立持有的图像；不能把流会复用的 CVPixelBuffer 直接当成截图保存。
            CGImageRef image = [context createCGImage:input fromRect:input.extent];
            // 将 Create 返回的 CF 所有权交给 ARC；后续返回调用方时另行 retain。
            self.image = CFBridgingRelease(image);
            if (!self.image) self.error = capture_error(@"Could not create captured image");
            self.finished = YES;
            dispatch_semaphore_signal(self.ready);
        }
    }
}
@end

// macOS 13 没有 SCScreenshotManager：启动流、等待首帧，再停止并返回自持有图像。
static CGImageRef stream_frame(SCContentFilter *filter, SCStreamConfiguration *config, NSError **error) {
    DictolFrame *receiver = [DictolFrame new];
    SCStream *stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:receiver];
    dispatch_queue_t queue = dispatch_queue_create("dictol.capture.frame", DISPATCH_QUEUE_SERIAL);
    if (![stream addStreamOutput:receiver type:SCStreamOutputTypeScreen sampleHandlerQueue:queue error:error]) return NULL;
    dispatch_semaphore_t started = dispatch_semaphore_create(0);
    dispatch_semaphore_t stopped = dispatch_semaphore_create(0);
    __block NSError *start_error;
    __block NSError *stop_error;
    // 首帧可能先于启动完成回调到达，因此流生命周期不能由 receiver.finished 推断。
    // 以下标志均由 receiver 的锁保护；request_stop 是唯一的停止入口。
    __block BOOL start_succeeded = NO;
    __block BOOL cancelled = NO;
    __block BOOL stop_requested = NO;
    BOOL (^request_stop)(void) = ^BOOL {
        @synchronized(receiver) {
            if (!start_succeeded) return NO;
            if (stop_requested) return YES;
            stop_requested = YES;
        }
        [stream stopCaptureWithCompletionHandler:^(NSError *err) {
            (void)stream; // 回调显式捕获 stream，保证它存活到停止完成。
            stop_error = err;
            dispatch_semaphore_signal(stopped);
        }];
        return YES;
    };
    [stream startCaptureWithCompletionHandler:^(NSError *err) {
        BOOL stop_after_start;
        @synchronized(receiver) {
            start_error = err;
            start_succeeded = !err;
            stop_after_start = cancelled && start_succeeded;
        }
        dispatch_semaphore_signal(started);
        // 等待方超时后仍可能启动成功，此回调负责停止晚到的流。
        if (stop_after_start) request_stop();
    }];
    BOOL success = wait_for(started, error);
    if (success && start_error) { *error = start_error; success = NO; }
    if (success) success = wait_for(receiver.ready, error);
    @synchronized(receiver) {
        cancelled = YES;
        receiver.finished = YES;
    }
    // 启动失败或尚未完成时不发出停止请求；晚到的成功由启动回调清理。
    // 已成功启动时等待唯一一次停止；清理失败不能覆盖更早的截图错误。
    if (!request_stop()) return NULL;
    NSError *stop_timeout;
    BOOL did_stop = wait_for(stopped, &stop_timeout);
    if (!success) return NULL;
    if (receiver.error) { *error = receiver.error; return NULL; }
    if (!did_stop || stop_error) { *error = stop_error ?: stop_timeout; return NULL; }
    return CGImageRetain((__bridge CGImageRef)receiver.image);
}

// 过滤器截图需显式指定输出像素数；调用方只提供目标的点尺寸。
static SCStreamConfiguration *capture_configuration(SCDisplay *display, CGSize size, NSError **error) {
    CGDisplayModeRef mode = CGDisplayCopyDisplayMode(display.displayID);
    double scale = mode && CGDisplayModeGetWidth(mode) ?
        (double)CGDisplayModeGetPixelWidth(mode) / CGDisplayModeGetWidth(mode) : 0;
    if (mode) CGDisplayModeRelease(mode);
    double width = round(size.width * scale), height = round(size.height * scale);
    if (!isfinite(width) || !isfinite(height) || width < 1 || height < 1 || width > UINT32_MAX || height > UINT32_MAX) {
        *error = capture_error(@"Capture dimensions are invalid");
        return nil;
    }
    SCStreamConfiguration *config = [SCStreamConfiguration new];
    config.width = (size_t)width;
    config.height = (size_t)height;
    config.showsCursor = NO;
    config.pixelFormat = kCVPixelFormatType_32BGRA;
    return config;
}

// 共享捕获执行，不负责判断截图类型；过滤器和源矩形由各入口明确构造。
static CGImageRef capture_filtered_image(SCContentFilter *filter, SCStreamConfiguration *config, NSError **error) {
    // 14+ 用过滤器截取单帧；13.x 回退为短时 SCStream。
    if (@available(macOS 14.0, *)) {
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block id image;
        __block NSError *failure;
        [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef value, NSError *err) {
            // 系统借出的 CGImage 由强引用保留，跨出回调后仍有效。
            image = value ? (__bridge id)value : nil;
            failure = err;
            dispatch_semaphore_signal(semaphore);
        }];
        if (!wait_for(semaphore, error)) return NULL;
        if (!image) *error = failure ?: capture_error(@"Screenshot returned no image");
        return image ? CGImageRetain((__bridge CGImageRef)image) : NULL;
    }
    return stream_frame(filter, config, error);
}

// 15.2+ 直接按全局屏幕矩形截图；声明可用版本，让编译器检查调用方的版本守卫。
static CGImageRef capture_image_in_rect(CGRect region, NSError **error)
    CF_RETURNS_RETAINED API_AVAILABLE(macos(15.2));
static CGImageRef capture_image_in_rect(CGRect region, NSError **error) {
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block id image;
    __block NSError *failure;
    [SCScreenshotManager captureImageInRect:region completionHandler:^(CGImageRef value, NSError *err) {
        image = value ? (__bridge id)value : nil;
        failure = err;
        dispatch_semaphore_signal(semaphore);
    }];
    if (!wait_for(semaphore, error)) return NULL;
    if (!image) *error = failure ?: capture_error(@"Screenshot returned no image");
    return image ? CGImageRetain((__bridge CGImageRef)image) : NULL;
}

// 较早系统通过显示器过滤器截图，将全局区域换算为显示器内的源矩形。
static CGImageRef capture_region_source_rect(SCDisplay *display, CGRect region, NSError **error) {
    SCStreamConfiguration *config = capture_configuration(display, region.size, error);
    if (!config) return NULL;
    // sourceRect 以显示器左上角为原点，输入 region 则使用全局坐标。
    config.sourceRect = CGRectMake(region.origin.x - display.frame.origin.x,
        region.origin.y - display.frame.origin.y, region.size.width, region.size.height);
    SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
    return capture_filtered_image(filter, config, error);
}

CGImageRef capture_region(uint32_t display_id, CGRect region, NSError **error) {
    SCShareableContent *items = get_shareable_content(NO, NO, error);
    if (!items) return NULL;
    SCDisplay *display = find_display(items, display_id, error);
    if (!display) return NULL;
    if (!CGRectContainsRect(display.frame, region)) {
        *error = capture_error(@"Screen region must be contained in the specified display");
        return NULL;
    }
    if (@available(macOS 15.2, *)) {
        return capture_image_in_rect(region, error);
    }
    return capture_region_source_rect(display, region, error);
}

CGImageRef capture_display(uint32_t display_id, NSError **error) {
    SCShareableContent *items = get_shareable_content(NO, NO, error);
    if (!items) return NULL;
    SCDisplay *display = find_display(items, display_id, error);
    if (!display) return NULL;
    SCStreamConfiguration *config = capture_configuration(display, display.frame.size, error);
    if (!config) return NULL;
    SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
    return capture_filtered_image(filter, config, error);
}

CGImageRef capture_window(uint32_t window_id, NSError **error) {
    SCShareableContent *items = get_shareable_content(NO, NO, error);
    if (!items) return NULL;
    SCWindow *window;
    for (SCWindow *item in items.windows) {
        if (item.windowID == window_id) { window = item; break; }
    }
    if (!window) {
        *error = capture_error(@"ScreenCaptureKit window was not found");
        return NULL;
    }
    // 跨屏窗口按重叠面积最大的显示器选择像素比例。
    SCDisplay *display;
    double maximum = 0;
    for (SCDisplay *item in items.displays) {
        double area = overlap(item.frame, window.frame);
        if (area > maximum) { maximum = area; display = item; }
    }
    if (!display) {
        *error = capture_error(@"ScreenCaptureKit display was not found");
        return NULL;
    }
    SCStreamConfiguration *config = capture_configuration(display, window.frame.size, error);
    if (!config) return NULL;
    SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:window];
    return capture_filtered_image(filter, config, error);
}
