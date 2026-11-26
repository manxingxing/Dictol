#pragma once

#include <stdbool.h>

enum {
  kToolbarPanel = 0,
  kPanelCount = kToolbarPanel + 1,
};

typedef enum {
  kPanelEventShow = 1,
  kPanelEventHide,
  kPanelEventResize,
  kPanelEventMove,
  kPanelEventFocus,
  kPanelEventBlur,
  kPanelEventResizeEnd,
} DictolPanelEvent;

typedef void (*DictolPanelNotify)(int panelId, DictolPanelEvent event);

typedef enum {
  kPanelOK = 1,
  kPanelInvalidTarget = 0,
  kPanelWrongThread = -1,
  kPanelPolicyRejected = -2,
  kPanelElectronClassMissing = -3,
  kPanelOverrideUnavailable = -4,
  kPanelScreenUnavailable = -5,
} DictolPanelStatus;

#ifdef __cplusplus
extern "C" {
#endif

// All panel operations must run on the AppKit main thread. Handles must point
// to live Objective-C objects. Output parameters are written on success only.
DictolPanelStatus dictol_configure_electron_panel(void *view);
DictolPanelStatus dictol_panel_create(int panelId, void *view, bool resizable, bool movable,
                                     DictolPanelNotify notify);
DictolPanelStatus dictol_panel_destroy(int panelId);
// Show and hide events report visibility transitions.
DictolPanelStatus dictol_panel_show(int panelId, bool focus);
DictolPanelStatus dictol_panel_hide(int panelId);
// Returns when AppKit finishes tracking the menu. On success, selected is
// true if the item's action was chosen or false if the menu was dismissed.
DictolPanelStatus dictol_panel_show_disable_menu(int panelId, bool enabled, bool *selected);
DictolPanelStatus dictol_panel_state(int panelId, unsigned int *state);
// values must have room for x, y, width, and height in that order.
DictolPanelStatus dictol_panel_bounds(int panelId, double values[4]);
DictolPanelStatus dictol_panel_set_bounds(int panelId, double x, double y, double width, double height);

#ifdef __cplusplus
}
#endif
