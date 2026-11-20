// Run production stream lifecycle code with controlled callback ordering, without TCC.
#import "capture.m"
#import <objc/runtime.h>
#include <assert.h>
#include <string.h>

static NSString *scenario;
static id<SCStreamOutput> output;
static NSUInteger stops;
static dispatch_semaphore_t late_stop;

static void deliver_frame(void) {
    DictolFrame *receiver = (DictolFrame *)output;
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(NULL, 1, 1, 8, 4, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    receiver.image = CFBridgingRelease(CGBitmapContextCreateImage(context));
    CGContextRelease(context);
    CGColorSpaceRelease(space);
    receiver.finished = YES;
    dispatch_semaphore_signal(receiver.ready);
}

@interface LifecycleStream : NSObject
@end
@implementation LifecycleStream
- (id)initWithFilter:(id)filter configuration:(id)config delegate:(id)delegate { return self; }
- (BOOL)addStreamOutput:(id)value type:(SCStreamOutputType)type
    sampleHandlerQueue:(dispatch_queue_t)queue error:(NSError **)error {
    output = value;
    return YES;
}
- (void)startCaptureWithCompletionHandler:(void (^)(NSError *))completion {
    if ([scenario isEqualToString:@"start-error"]) {
        completion(capture_error(@"start failed"));
    } else if ([scenario isEqualToString:@"start-timeout"]) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5100 * NSEC_PER_MSEC),
            dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{ completion(nil); });
    } else if ([scenario isEqualToString:@"frame-timeout"]) {
        completion(nil);
    } else if ([scenario isEqualToString:@"frame-before-start"]) {
        deliver_frame();
        completion(nil);
    } else {
        completion(nil);
        deliver_frame();
    }
}
- (void)stopCaptureWithCompletionHandler:(void (^)(NSError *))completion {
    stops++;
    completion(stops > 1 || [scenario isEqualToString:@"stop-error"]
        ? capture_error(@"stop failed") : nil);
    dispatch_semaphore_signal(late_stop);
}
@end

static id allocate_stream(id self, SEL selector) NS_RETURNS_RETAINED;
static id allocate_stream(id self, SEL selector) { return [LifecycleStream alloc]; }

int main(int argc, const char **argv) {
    @autoreleasepool {
        assert(argc == 2);
        scenario = [NSString stringWithUTF8String:argv[1]];
        late_stop = dispatch_semaphore_create(0);
        // Override SCStream allocation only in this standalone test process.
        assert(class_addMethod(object_getClass(SCStream.class), @selector(alloc),
                               (IMP)allocate_stream, "@@:"));
        NSError *error = nil;
        CGImageRef image = stream_frame(nil, nil, &error);
        if ([scenario isEqualToString:@"start-timeout"]) {
            assert(!image && [error.localizedDescription containsString:@"timed out"]);
            assert(dispatch_semaphore_wait(late_stop, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) == 0);
        } else if ([scenario isEqualToString:@"frame-timeout"]) {
            assert(!image && [error.localizedDescription containsString:@"timed out"]);
        } else if ([scenario isEqualToString:@"start-error"]) {
            assert(!image && [error.localizedDescription isEqualToString:@"start failed"]);
        } else if ([scenario isEqualToString:@"stop-error"]) {
            assert(!image && [error.localizedDescription isEqualToString:@"stop failed"]);
        } else {
            assert(image && !error);
        }
        assert(stops == ([scenario isEqualToString:@"start-error"] ? 0 : 1));
        if (image) CGImageRelease(image);
        output = nil;
    }
    return 0;
}
