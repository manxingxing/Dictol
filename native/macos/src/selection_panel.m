#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <pthread.h>
#include "selection_panel.h"

@interface DictolSelectionPanel : NSPanel <NSWindowDelegate>
@property(nonatomic, assign) int panelId;
@property(nonatomic, assign) DictolPanelNotify notify;
@property(nonatomic, assign) BOOL originalHostHasShadow;
@property(nonatomic, assign) BOOL originalHostOpaque;
@property(nonatomic, strong) NSColor *originalHostBackgroundColor;
@property(nonatomic, assign) NSAutoresizingMaskOptions originalContentAutoresizingMask;
@end

@implementation DictolSelectionPanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
- (void)disableSelectionFromMenu:(id)sender {
  // AppKit reports the choice when menu tracking returns.
}
- (void)windowDidBecomeKey:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, kPanelEventFocus);
}
- (void)windowDidResignKey:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, kPanelEventBlur);
}
- (void)windowDidResize:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, kPanelEventResize);
}
- (void)windowDidEndLiveResize:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, kPanelEventResizeEnd);
}
- (void)windowDidMove:(NSNotification *)notification {
  if (self.notify) self.notify(self.panelId, kPanelEventMove);
}
@end

static DictolSelectionPanel *panels[kPanelCount];
static NSWindow *hosts[kPanelCount];
static NSView *hostContents[kPanelCount];
static const NSWindowCollectionBehavior kSelectionPanelCollectionBehavior =
    NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorFullScreenAuxiliary |
    NSWindowCollectionBehaviorIgnoresCycle;
static char kDictolConfiguredElectronPanelKey;
typedef void (*CollectionBehaviorSetter)(id, SEL, NSWindowCollectionBehavior);
static CollectionBehaviorSetter electronPanelCollectionBehaviorSetter;
static CollectionBehaviorSetter windowCollectionBehaviorSetter;
static pthread_once_t electronPanelSwizzleOnce = PTHREAD_ONCE_INIT;

static void dictol_electron_panel_set_collection_behavior(
    id self, SEL selector, NSWindowCollectionBehavior behavior) {
  // Both setters are available before installing the override.
  if (objc_getAssociatedObject(self, &kDictolConfiguredElectronPanelKey)) {
    windowCollectionBehaviorSetter(self, selector, behavior);
    return;
  }
  electronPanelCollectionBehaviorSetter(self, selector, behavior);
}

static void install_electron_panel_collection_behavior_override(void) {
  Class electronPanelClass = NSClassFromString(@"ElectronNSPanel");
  SEL selector = @selector(setCollectionBehavior:);
  Method method = class_getInstanceMethod(electronPanelClass, selector);
  Method windowMethod = class_getInstanceMethod(NSWindow.class, selector);
  if (!method || !windowMethod) return;

  electronPanelCollectionBehaviorSetter = (CollectionBehaviorSetter)method_getImplementation(method);
  windowCollectionBehaviorSetter = (CollectionBehaviorSetter)method_getImplementation(windowMethod);
  // Install on ElectronNSPanel even when the lookup returned a superclass method.
  class_replaceMethod(electronPanelClass, selector,
                      (IMP)dictol_electron_panel_set_collection_behavior,
                      method_getTypeEncoding(method));
}

static NSView *content_view_from_handle(void *viewPointer) {
  // Electron passes a live NSView*. Check its class before reading .window.
  id object = (__bridge id)viewPointer;
  return [object isKindOfClass:NSView.class] ? object : nil;
}

DictolPanelStatus dictol_configure_electron_panel(void *viewPointer) {
  @autoreleasepool {
    if (!pthread_main_np()) return kPanelWrongThread;
    NSView *content = content_view_from_handle(viewPointer);
    NSWindow *window = content.window;
    if (!window || window.contentView != content) return kPanelInvalidTarget;
    Class electronPanelClass = NSClassFromString(@"ElectronNSPanel");
    if (!electronPanelClass) return kPanelElectronClassMissing;
    if (![window isKindOfClass:electronPanelClass]) return kPanelInvalidTarget;

    // After successful configuration the window keeps the marker for its
    // lifetime so Electron's later updates also use the AppKit setter.
    if (pthread_once(&electronPanelSwizzleOnce, install_electron_panel_collection_behavior_override) != 0 ||
        !windowCollectionBehaviorSetter) return kPanelOverrideUnavailable;

    NSWindowCollectionBehavior originalBehavior = window.collectionBehavior;
    NSWindowLevel originalLevel = window.level;
    id originalMarker = objc_getAssociatedObject(window, &kDictolConfiguredElectronPanelKey);
    objc_setAssociatedObject(window, &kDictolConfiguredElectronPanelKey, @YES,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    window.collectionBehavior = kSelectionPanelCollectionBehavior;
    window.level = NSScreenSaverWindowLevel;

    // Fail immediately if the requested workspace/fullscreen policy did not
    // survive Electron's setter or AppKit's normalization.
    NSWindowCollectionBehavior behavior = window.collectionBehavior;
    BOOL hasRequiredPolicy =
        (behavior & NSWindowCollectionBehaviorCanJoinAllSpaces) == 0 &&
        (behavior & kSelectionPanelCollectionBehavior) == kSelectionPanelCollectionBehavior &&
        window.level == NSScreenSaverWindowLevel;
    if (!hasRequiredPolicy) {
      window.level = originalLevel;
      // Restore the value read from the window. Electron's setter can change it.
      windowCollectionBehaviorSetter(window, @selector(setCollectionBehavior:), originalBehavior);
      objc_setAssociatedObject(window, &kDictolConfiguredElectronPanelKey, originalMarker,
                               OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      return kPanelPolicyRejected;
    }
    return kPanelOK;
  }
}

static BOOL validPanelId(int panelId) {
  return panelId >= 0 && panelId < kPanelCount;
}

DictolPanelStatus dictol_panel_create(int panelId, void *viewPointer, bool resizable, bool movable,
                                     DictolPanelNotify notify) {
  @autoreleasepool {
    if (!pthread_main_np()) return kPanelWrongThread;
    if (!validPanelId(panelId) || panels[panelId]) return kPanelInvalidTarget;

    NSView *content = content_view_from_handle(viewPointer);
    NSWindow *host = content.window;
    if (!host || host.contentView != content) return kPanelInvalidTarget;

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
    panel.collectionBehavior = kSelectionPanelCollectionBehavior;
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
    // Fail at the bridge boundary instead of silently creating a panel that
    // violates Dictol's workspace, activation, or fullscreen requirements.
    NSWindowCollectionBehavior behavior = panel.collectionBehavior;
    BOOL hasRequiredPolicy =
        (panel.styleMask & NSWindowStyleMaskNonactivatingPanel) != 0 &&
        panel.canBecomeKeyWindow && !panel.canBecomeMainWindow &&
        (behavior & NSWindowCollectionBehaviorCanJoinAllSpaces) == 0 &&
        (behavior & kSelectionPanelCollectionBehavior) == kSelectionPanelCollectionBehavior;
    if (!hasRequiredPolicy) {
      [panel close];
      return kPanelPolicyRejected;
    }

    panel.notify = notify;
    panel.delegate = panel;
    panel.originalHostHasShadow = host.hasShadow;
    panel.originalHostOpaque = host.opaque;
    panel.originalHostBackgroundColor = host.backgroundColor;
    panel.originalContentAutoresizingMask = content.autoresizingMask;

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
    return kPanelOK;
  }
}

DictolPanelStatus dictol_panel_destroy(int panelId) {
  @autoreleasepool {
    if (!pthread_main_np()) return kPanelWrongThread;
    if (!validPanelId(panelId) || !panels[panelId]) return kPanelInvalidTarget;

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
      content.autoresizingMask = panel.originalContentAutoresizingMask;
      host.backgroundColor = panel.originalHostBackgroundColor;
      host.opaque = panel.originalHostOpaque;
      host.hasShadow = panel.originalHostHasShadow;
    }
    [panel close];
    panels[panelId] = nil;
    hosts[panelId] = nil;
    hostContents[panelId] = nil;
    return kPanelOK;
  }
}

DictolPanelStatus dictol_panel_show(int panelId, bool focus) {
  @autoreleasepool {
    if (!pthread_main_np()) return kPanelWrongThread;
    if (!validPanelId(panelId) || !panels[panelId]) return kPanelInvalidTarget;
    DictolSelectionPanel *panel = panels[panelId];
    BOOL wasVisible = panel.isVisible;
    [panel orderFrontRegardless];
    if (focus) [panel makeKeyWindow];
    if (!wasVisible && panel.isVisible && panel.notify) panel.notify(panelId, kPanelEventShow);
    return kPanelOK;
  }
}

DictolPanelStatus dictol_panel_hide(int panelId) {
  @autoreleasepool {
    if (!pthread_main_np()) return kPanelWrongThread;
    if (!validPanelId(panelId) || !panels[panelId]) return kPanelInvalidTarget;
    DictolSelectionPanel *panel = panels[panelId];
    if (!panel.isVisible) return kPanelOK;
    [panel orderOut:nil];
    if (!panel.isVisible && panel.notify) panel.notify(panelId, kPanelEventHide);
    return kPanelOK;
  }
}

static NSPoint disable_menu_anchor(NSPanel *panel, NSSize menuSize) {
  NSView *view = panel.contentView;
  NSRect toolbar = [panel convertRectToScreen:[view convertRect:view.bounds toView:nil]];
  NSPoint cursor = [panel convertPointToScreen:panel.mouseLocationOutsideOfEventStream];

  // With no positioning item, AppKit expects the menu's top-left corner.
  // Use y-up screen coordinates for placement, then convert back into the view.
  NSPoint anchor = NSMakePoint(MIN(MAX(cursor.x, NSMinX(toolbar)), NSMaxX(toolbar)),
                               NSMinY(toolbar));
  NSScreen *screen = panel.screen;
  if (screen) {
    NSRect visible = screen.visibleFrame;
    if (anchor.y - menuSize.height < NSMinY(visible)) {
      anchor.y = NSMaxY(toolbar) + menuSize.height;
    }
    anchor.x = MAX(NSMinX(visible), MIN(anchor.x, NSMaxX(visible) - menuSize.width));
    anchor.y = MIN(NSMaxY(visible), MAX(anchor.y, NSMinY(visible) + menuSize.height));
  }
  return [view convertPoint:[panel convertPointFromScreen:anchor] fromView:nil];
}

DictolPanelStatus dictol_panel_show_disable_menu(int panelId, bool enabled, bool *selected) {
  @autoreleasepool {
    if (!pthread_main_np()) return kPanelWrongThread;
    if (!validPanelId(panelId) || !panels[panelId].isVisible || !selected) return kPanelInvalidTarget;

    DictolSelectionPanel *panel = panels[panelId];
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@""];
    menu.autoenablesItems = NO;
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:@"在此应用禁用划词"
                                                action:@selector(disableSelectionFromMenu:)
                                         keyEquivalent:@""];
    item.target = panel;
    item.enabled = enabled;
    [menu addItem:item];

    NSPoint anchor = disable_menu_anchor(panel, menu.size);
    *selected = [menu popUpMenuPositioningItem:nil atLocation:anchor inView:panel.contentView];
    return kPanelOK;
  }
}

DictolPanelStatus dictol_panel_state(int panelId, unsigned int *state) {
  @autoreleasepool {
    if (!pthread_main_np()) return kPanelWrongThread;
    if (!validPanelId(panelId) || !panels[panelId] || !state) return kPanelInvalidTarget;
    DictolSelectionPanel *panel = panels[panelId];
    *state = (panel.isVisible ? 1u : 0u) | (panel.isKeyWindow ? 2u : 0u);
    return kPanelOK;
  }
}

DictolPanelStatus dictol_panel_bounds(int panelId, double values[4]) {
  @autoreleasepool {
    if (!pthread_main_np()) return kPanelWrongThread;
    if (!validPanelId(panelId) || !panels[panelId] || !values) return kPanelInvalidTarget;
    NSRect frame = panels[panelId].frame;
    NSScreen *primaryScreen = NSScreen.screens.firstObject;
    if (!primaryScreen) return kPanelScreenUnavailable;
    values[0] = frame.origin.x;
    values[1] = NSMaxY(primaryScreen.frame) - NSMaxY(frame);
    values[2] = frame.size.width;
    values[3] = frame.size.height;
    return kPanelOK;
  }
}

DictolPanelStatus dictol_panel_set_bounds(int panelId, double x, double y, double width, double height) {
  @autoreleasepool {
    if (!pthread_main_np()) return kPanelWrongThread;
    if (!validPanelId(panelId) || !panels[panelId]) return kPanelInvalidTarget;
    NSScreen *primaryScreen = NSScreen.screens.firstObject;
    if (!primaryScreen) return kPanelScreenUnavailable;
    NSRect frame = NSMakeRect(x, NSMaxY(primaryScreen.frame) - y - height, width, height);
    DictolSelectionPanel *panel = panels[panelId];
    // A geometry listener can write back the frame it just read without
    // generating another move or resize event for that same frame.
    if (!NSEqualRects(panel.frame, frame)) [panel setFrame:frame display:YES];
    // The reparented Chromium view fills the panel's local content rect.
    panel.contentView.frame = panel.contentView.bounds;
    // Keep Electron's hidden owner in sync with the frame of its visible content.
    NSWindow *host = hosts[panelId];
    if (host) [host setFrame:frame display:NO];
    return kPanelOK;
  }
}
