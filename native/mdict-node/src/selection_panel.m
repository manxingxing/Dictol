#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <pthread.h>
#include <stdbool.h>

enum {
  kToolbarPanel = 0,
  kPanelCount = kToolbarPanel + 1,
};

@interface DictolSelectionPanel : NSPanel <NSWindowDelegate>
@property(nonatomic, assign) int panelId;
@property(nonatomic, assign) void (*notify)(int, int);
@end

@implementation DictolSelectionPanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
- (void)disableSelectionFromMenu:(id)sender {
  if (self.notify) self.notify(self.panelId, 8);
}
- (void)windowDidBecomeKey:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, 5);
}
- (void)windowDidResignKey:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, 6);
}
- (void)windowDidResize:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, 3);
}
- (void)windowDidEndLiveResize:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, 7);
}
- (void)windowDidMove:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, 4);
}
@end

static DictolSelectionPanel *panels[kPanelCount];
static NSWindow *hosts[kPanelCount];
static NSView *hostContents[kPanelCount];
static char kDictolConfiguredElectronPanelKey;
static IMP electronPanelCollectionBehaviorSetter;
static pthread_once_t electronPanelSwizzleOnce = PTHREAD_ONCE_INIT;

typedef void (*CollectionBehaviorSetter)(id, SEL, NSWindowCollectionBehavior);

static void dictol_electron_panel_set_collection_behavior(
    id self, SEL selector, NSWindowCollectionBehavior behavior) {
  // Only configured Electron panels bypass Electron's own Spaces policy;
  // every other window still uses the original implementation.
  if (objc_getAssociatedObject(self, &kDictolConfiguredElectronPanelKey)) {
    Method baseMethod = class_getInstanceMethod(NSWindow.class, selector);
    IMP baseSetter = baseMethod ? method_getImplementation(baseMethod) : NULL;
    if (baseSetter) {
      ((CollectionBehaviorSetter)baseSetter)(self, selector, behavior);
      return;
    }
  }
  if (electronPanelCollectionBehaviorSetter) {
    ((CollectionBehaviorSetter)electronPanelCollectionBehaviorSetter)(self, selector, behavior);
  }
}

static void install_electron_panel_collection_behavior_override(void) {
  Class electronPanelClass = NSClassFromString(@"ElectronNSPanel");
  SEL selector = @selector(setCollectionBehavior:);
  Method method = electronPanelClass ? class_getInstanceMethod(electronPanelClass, selector) : NULL;
  if (!method) return;
  electronPanelCollectionBehaviorSetter = method_setImplementation(
      method, (IMP)dictol_electron_panel_set_collection_behavior);
}

static BOOL is_electron_panel(NSWindow *window) {
  Class electronPanelClass = NSClassFromString(@"ElectronNSPanel");
  if (!electronPanelClass || !window) return NO;
  for (Class current = object_getClass(window); current; current = class_getSuperclass(current)) {
    if (current == electronPanelClass) return YES;
  }
  return NO;
}

int dictol_configure_electron_panel(void *viewPointer) {
  @autoreleasepool {
    if (!pthread_main_np()) return -1;
    if (!viewPointer) return 0;
    NSView *content = (__bridge NSView *)viewPointer;
    NSWindow *window = content.window;
    if (!window || window.contentView != content || !is_electron_panel(window)) return 0;

    // Install the class override once, then mark this particular window so the
    // override can apply AppKit's collection behavior to it alone.
    pthread_once(&electronPanelSwizzleOnce, install_electron_panel_collection_behavior_override);
    if (!electronPanelCollectionBehaviorSetter) return 0;

    objc_setAssociatedObject(window, &kDictolConfiguredElectronPanelKey, @YES,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    window.collectionBehavior = NSWindowCollectionBehaviorTransient |
                                NSWindowCollectionBehaviorFullScreenAuxiliary |
                                NSWindowCollectionBehaviorIgnoresCycle;
    window.level = NSScreenSaverWindowLevel;

    // Fail immediately if the requested workspace/fullscreen policy did not
    // survive Electron's setter or AppKit's normalization.
    NSWindowCollectionBehavior behavior = window.collectionBehavior;
    BOOL hasRequiredPolicy =
        (behavior & NSWindowCollectionBehaviorCanJoinAllSpaces) == 0 &&
        (behavior & NSWindowCollectionBehaviorTransient) != 0 &&
        (behavior & NSWindowCollectionBehaviorFullScreenAuxiliary) != 0 &&
        window.level == NSScreenSaverWindowLevel;
    if (!hasRequiredPolicy) {
      objc_setAssociatedObject(window, &kDictolConfiguredElectronPanelKey, nil,
                               OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      return 0;
    }
    return 1;
  }
}

static BOOL validPanelId(int panelId) {
  return panelId == kToolbarPanel;
}

int dictol_panel_create(int panelId, void *viewPointer, bool resizable, bool movable,
                        void (*notify)(int, int)) {
  @autoreleasepool {
    if (!pthread_main_np()) return -1;
    if (!validPanelId(panelId) || panels[panelId] || !viewPointer) return 0;

    // On macOS Electron documents this handle as an NSView*, not an NSWindow*.
    // BrowserWindow currently supplies its BridgedContentView, so recover its
    // owning window before reparenting the view. Never message the raw handle
    // as an NSWindow: doing so sends NSWindow selectors to an NSView and aborts.
    NSView *content = (__bridge NSView *)viewPointer;
    NSWindow *host = content.window;
    if (!content || !host || host.contentView != content) return 0;

    // The renderer remains owned by its BrowserWindow; this separate AppKit
    // panel supplies the visible non-activating window around that same view.
    NSWindowStyleMask style = NSWindowStyleMaskNonactivatingPanel;
    style |= NSWindowStyleMaskBorderless;
    if (resizable) style |= NSWindowStyleMaskResizable;

    DictolSelectionPanel *panel = [[DictolSelectionPanel alloc]
        initWithContentRect:host.frame
                  styleMask:style
                    backing:NSBackingStoreBuffered
                      defer:NO];
    panel.releasedWhenClosed = NO;
    panel.hidesOnDeactivate = NO;
    panel.becomesKeyOnlyIfNeeded = NO;
    panel.collectionBehavior = NSWindowCollectionBehaviorTransient |
                              NSWindowCollectionBehaviorFullScreenAuxiliary;
    panel.level = NSScreenSaverWindowLevel;
    // The renderer draws the rounded popup surface. Keep the native panel
    // transparent outside that surface so its shadow cannot expose a square
    // background rectangle around the renderer's rounded corners.
    panel.opaque = NO;
    panel.backgroundColor = NSColor.clearColor;
    panel.hasShadow = host.hasShadow;
    panel.minSize = host.minSize;
    panel.movableByWindowBackground = movable;
    panel.panelId = panelId;
    panel.notify = notify;
    panel.delegate = panel;

    // Fail at the bridge boundary instead of silently creating a panel that
    // violates Dictol's workspace, activation, or fullscreen requirements.
    NSWindowCollectionBehavior behavior = panel.collectionBehavior;
    BOOL hasRequiredPolicy =
        (panel.styleMask & NSWindowStyleMaskNonactivatingPanel) != 0 &&
        panel.canBecomeKeyWindow && !panel.canBecomeMainWindow &&
        (behavior & NSWindowCollectionBehaviorCanJoinAllSpaces) == 0 &&
        (behavior & NSWindowCollectionBehaviorTransient) != 0 &&
        (behavior & NSWindowCollectionBehaviorFullScreenAuxiliary) != 0;
    if (!hasRequiredPolicy) {
      [panel close];
      return 0;
    }

    // Chromium requires its BridgedContentView to remain the actual content
    // view of the visible NSWindow. Do not put an AppKit wrapper above it.
    content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    host.contentView = [[NSView alloc] initWithFrame:content.frame];
    panel.contentView = content;
    panels[panelId] = panel;
    hosts[panelId] = host;
    hostContents[panelId] = content;
    // The BrowserWindow is only a hidden owner for Chromium. Clear its native
    // frame decoration so it cannot leave a second rectangular edge behind.
    host.hasShadow = NO;
    host.opaque = NO;
    host.backgroundColor = NSColor.clearColor;
    [host orderOut:nil];
    return 1;
  }
}

int dictol_panel_destroy(int panelId) {
  @autoreleasepool {
    if (!pthread_main_np()) return -1;
    if (!validPanelId(panelId) || !panels[panelId]) return 0;

    DictolSelectionPanel *panel = panels[panelId];
    NSWindow *host = hosts[panelId];
    NSView *content = hostContents[panelId];
    // Stop callbacks before reattaching Chromium's view to its Electron owner.
    // The host can then be destroyed without leaving its content in this panel.
    panel.notify = NULL;
    panel.delegate = nil;
    [panel orderOut:nil];
    if (host && content) {
      panel.contentView = [[NSView alloc] initWithFrame:content.frame];
      host.contentView = content;
    }
    [panel close];
    panels[panelId] = nil;
    hosts[panelId] = nil;
    hostContents[panelId] = nil;
    return 1;
  }
}

int dictol_panel_show(int panelId, bool focus) {
  @autoreleasepool {
    if (!pthread_main_np()) return -1;
    if (!validPanelId(panelId) || !panels[panelId]) return 0;
    DictolSelectionPanel *panel = panels[panelId];
    [panel orderFrontRegardless];
    if (focus) [panel makeKeyWindow];
    if (panel.notify) panel.notify(panelId, 1);
    return 1;
  }
}

int dictol_panel_hide(int panelId) {
  @autoreleasepool {
    if (!pthread_main_np()) return -1;
    if (!validPanelId(panelId) || !panels[panelId]) return 0;
    [panels[panelId] orderOut:nil];
    if (panels[panelId].notify) panels[panelId].notify(panelId, 2);
    return 1;
  }
}

int dictol_panel_show_disable_menu(int panelId, bool enabled) {
  @autoreleasepool {
    if (!pthread_main_np()) return -1;
    if (!validPanelId(panelId) || !panels[panelId] || !panels[panelId].isVisible) return 0;

    DictolSelectionPanel *panel = panels[panelId];
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@""];
    menu.autoenablesItems = NO;
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:@"在此应用禁用划词"
                                                action:@selector(disableSelectionFromMenu:)
                                         keyEquivalent:@""];
    item.target = panel;
    item.enabled = enabled;
    [menu addItem:item];

    NSPoint windowPoint = [panel mouseLocationOutsideOfEventStream];
    NSPoint menuPoint = [panel.contentView convertPoint:windowPoint fromView:nil];
    // Keep the menu just below the toolbar. The popup otherwise opens centered
    // on the click and overlaps the row of toolbar actions.
    menuPoint.y -= panel.contentView.bounds.size.height / 2.0;
    [menu popUpMenuPositioningItem:nil atLocation:menuPoint inView:panel.contentView];
    return 1;
  }
}

unsigned int dictol_panel_state(int panelId) {
  if (!pthread_main_np() || !validPanelId(panelId) || !panels[panelId]) return 0;
  DictolSelectionPanel *panel = panels[panelId];
  unsigned int state = 0;
  if (panel.isVisible) state |= 1;
  if (panel.isKeyWindow) state |= 2;
  return state;
}

int dictol_panel_bounds(int panelId, double *values) {
  if (!pthread_main_np()) return -1;
  if (!validPanelId(panelId) || !panels[panelId] || !values) return 0;
  NSRect frame = panels[panelId].frame;
  NSScreen *primaryScreen = NSScreen.screens.firstObject;
  if (!primaryScreen) return 0;
  values[0] = frame.origin.x;
  values[1] = NSMaxY(primaryScreen.frame) - NSMaxY(frame);
  values[2] = frame.size.width;
  values[3] = frame.size.height;
  return 1;
}

int dictol_panel_set_bounds(int panelId, double x, double y, double width, double height) {
  if (!pthread_main_np()) return -1;
  if (!validPanelId(panelId) || !panels[panelId]) return 0;
  NSScreen *primaryScreen = NSScreen.screens.firstObject;
  if (!primaryScreen) return 0;
  NSRect frame = NSMakeRect(x, NSMaxY(primaryScreen.frame) - y - height, width, height);
  DictolSelectionPanel *panel = panels[panelId];
  [panel setFrame:frame display:YES];
  panel.contentView.frame = panel.contentView.bounds;
  NSWindow *host = hosts[panelId];
  if (host) [host setFrame:frame display:NO];
  return 1;
}
