// Exercise the macOS 13 frame receiver with real CoreMedia buffers, without screen access.
#import "capture.m"
#include <assert.h>
#include <string.h>

static CMSampleBufferRef make_sample(CVPixelBufferRef buffer, SCFrameStatus status) {
    CMVideoFormatDescriptionRef format = NULL;
    assert(CMVideoFormatDescriptionCreateForImageBuffer(NULL, buffer, &format) == noErr);
    CMSampleTimingInfo timing = {kCMTimeInvalid, kCMTimeZero, kCMTimeInvalid};
    CMSampleBufferRef sample = NULL;
    assert(CMSampleBufferCreateReadyWithImageBuffer(NULL, buffer, format, &timing, &sample) == noErr);
    CFRelease(format);
    NSMutableArray *attachments = (__bridge NSMutableArray *)CMSampleBufferGetSampleAttachmentsArray(sample, YES);
    attachments[0][SCStreamFrameInfoStatus] = @(status);
    return sample;
}

int main(void) {
    @autoreleasepool {
        CGRect display = CGRectMake(-1920, -200, 1920, 1080);
        assert(CGRectContainsRect(display, CGRectMake(-1920, -200, 100, 100)));
        assert(overlap(display, CGRectMake(-10, 0, 20, 20)) == 200);
        assert(overlap(display, CGRectMake(0, 0, 20, 20)) == 0);

        CVPixelBufferRef buffer = NULL;
        assert(CVPixelBufferCreate(NULL, 16, 16, kCVPixelFormatType_32BGRA, NULL, &buffer) == kCVReturnSuccess);
        CVPixelBufferLockBaseAddress(buffer, 0);
        uint8_t *pixels = CVPixelBufferGetBaseAddress(buffer);
        size_t stride = CVPixelBufferGetBytesPerRow(buffer);
        for (size_t y = 0; y < 16; y++) for (size_t x = 0; x < 16; x++) {
            uint8_t *pixel = pixels + y * stride + x * 4;
            pixel[0] = 0; pixel[1] = 0; pixel[2] = 255; pixel[3] = 255;
        }
        CVPixelBufferUnlockBaseAddress(buffer, 0);
        // The receiver does not access the sender; use a stand-in without starting a stream.
        SCStream *sender = (SCStream *)[NSObject new];
        DictolFrame *receiver = [DictolFrame new];
        CMSampleBufferRef idle = make_sample(buffer, SCFrameStatusIdle);
        [receiver stream:sender didOutputSampleBuffer:idle ofType:SCStreamOutputTypeScreen];
        assert(!receiver.finished && !receiver.image);
        CFRelease(idle);
        CMSampleBufferRef sample = make_sample(buffer, SCFrameStatusComplete);
        [receiver stream:sender didOutputSampleBuffer:sample ofType:SCStreamOutputTypeScreen];
        assert(receiver.finished && !receiver.error && receiver.image);
        assert(dispatch_semaphore_wait(receiver.ready, DISPATCH_TIME_NOW) == 0);
        CGImageRef image = CGImageRetain((__bridge CGImageRef)receiver.image);
        CFRelease(sample);
        CVPixelBufferLockBaseAddress(buffer, 0);
        memset(CVPixelBufferGetBaseAddress(buffer), 0, stride * 16);
        CVPixelBufferUnlockBaseAddress(buffer, 0);
        CVPixelBufferRelease(buffer);
        // Late errors and frames cannot replace an already completed result.
        [receiver stream:sender didStopWithError:capture_error(@"late error")];
        assert(!receiver.error);
        receiver = nil;
        uint8_t output[16 * 16 * 4] = {0};
        CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
        CGContextRef context = CGBitmapContextCreate(output, 16, 16, 8, 64, space,
            kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
        CGContextDrawImage(context, CGRectMake(0, 0, 16, 16), image);
        assert(output[0] > 250 && output[1] < 5 && output[2] < 5 && output[3] == 255);
        CGContextRelease(context);
        CGColorSpaceRelease(space);
        CGImageRelease(image);

        DictolFrame *failed = [DictolFrame new];
        [failed stream:sender didStopWithError:capture_error(@"stream failed")];
        assert(failed.finished && failed.error && !failed.image);
        assert(dispatch_semaphore_wait(failed.ready, DISPATCH_TIME_NOW) == 0);
    }
    return 0;
}
