// Temporary test helper: posts a real mouse click at a screen coordinate so the
// non-activation behavior can be exercised without manual interaction.
//
// Compile: clang -fobjc-arc -framework Foundation -framework ApplicationServices \
//            -o /tmp/dictol-click /tmp/dictol-click.m
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc < 3) {
      fprintf(stderr, "usage: dictol-click <x> <y>\n");
      return 2;
    }
    CGPoint point = CGPointMake(atof(argv[1]), atof(argv[2]));

    CGEventRef move = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, point, kCGMouseButtonLeft);
    CGEventPost(kCGHIDEventTap, move);
    CFRelease(move);
    usleep(120000);

    CGEventRef down = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, point, kCGMouseButtonLeft);
    CGEventPost(kCGHIDEventTap, down);
    CFRelease(down);
    usleep(120000);

    CGEventRef up = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, point, kCGMouseButtonLeft);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(up);

    printf("posted click at %.0f,%.0f\n", point.x, point.y);
  }
  return 0;
}
