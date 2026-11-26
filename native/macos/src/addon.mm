#define NAPI_VERSION 8
#include <node_api.h>
#include <pthread.h>
#include <cmath>
#include <cstring>
#include "selection_panel.h"

static const char *event_name(DictolPanelEvent event) {
  switch (event) {
    case kPanelEventShow: return "show";
    case kPanelEventHide: return "hide";
    case kPanelEventResize: return "resize";
    case kPanelEventMove: return "move";
    case kPanelEventFocus: return "focus";
    case kPanelEventBlur: return "blur";
    case kPanelEventResizeEnd: return "resize-end";
  }
  return nullptr;
}

static napi_threadsafe_function panelCallback;
static napi_env panelOwner;

static void deliver_event(napi_env env, napi_value callback, void *, void *data) {
  if (!env) return; // Queued events can be discarded during environment teardown.
  napi_value args[2], receiver, result;
  napi_get_null(env, &args[0]);
  auto event = static_cast<DictolPanelEvent>(reinterpret_cast<uintptr_t>(data));
  napi_create_string_utf8(env, event_name(event), NAPI_AUTO_LENGTH, &args[1]);
  napi_get_undefined(env, &receiver);
  napi_call_function(env, receiver, callback, 2, args, &result);
}

static void notify(int, DictolPanelEvent event) {
  if (panelCallback && event_name(event)) {
    // AppKit delegates may run inside setFrame:, but JavaScript receives these
    // notifications through the event-loop queue after the native call returns.
    napi_call_threadsafe_function(panelCallback, reinterpret_cast<void *>(static_cast<uintptr_t>(event)),
                                  napi_tsfn_nonblocking);
  }
}

static void release_callback() {
  if (panelCallback) napi_release_threadsafe_function(panelCallback, napi_tsfn_abort);
  panelCallback = nullptr;
  panelOwner = nullptr;
}

static void cleanup(void *data) {
  if (panelOwner == data) {
    dictol_panel_destroy(kToolbarPanel);
    release_callback();
  }
}

static bool is_type(napi_env env, napi_value value, napi_valuetype expected) {
  napi_valuetype type;
  return napi_typeof(env, value, &type) == napi_ok && type == expected;
}

static bool number(napi_env env, napi_value value, double *output) {
  return is_type(env, value, napi_number) &&
         napi_get_value_double(env, value, output) == napi_ok && std::isfinite(*output);
}

static bool handle(napi_env env, napi_value value, void **output) {
  bool buffer = false;
  size_t size = 0;
  void *bytes = nullptr;
  if (napi_is_buffer(env, value, &buffer) != napi_ok || !buffer ||
      napi_get_buffer_info(env, value, &bytes, &size) != napi_ok || size != sizeof(void *)) return false;
  std::memcpy(output, bytes, size);
  return *output != nullptr;
}

enum Operation { Configure, Create, Destroy, Show, Hide, Menu, State, Bounds, SetBounds };

static void throw_panel_error(napi_env env, Operation op, DictolPanelStatus status) {
  switch (status) {
    case kPanelInvalidTarget:
      if (op == Configure || op == Create) {
        napi_throw_error(env, "ERR_PANEL_INVALID_HOST", op == Configure
            ? "Expected the content view of an Electron panel"
            : "Expected an Electron window content view for selection panel creation");
      } else {
        napi_throw_error(env, "ERR_PANEL_UNAVAILABLE", "No selection panel is available for this operation");
      }
      return;
    case kPanelWrongThread:
      napi_throw_error(env, "ERR_PANEL_WRONG_THREAD", "macOS panels must run on the main thread");
      return;
    case kPanelPolicyRejected:
      napi_throw_error(env, "ERR_PANEL_POLICY_REJECTED", "AppKit did not apply the requested panel policy");
      return;
    case kPanelElectronClassMissing:
      napi_throw_error(env, "ERR_PANEL_ELECTRON_CLASS_MISSING", "ElectronNSPanel is unavailable");
      return;
    case kPanelOverrideUnavailable:
      napi_throw_error(env, "ERR_PANEL_OVERRIDE_UNAVAILABLE", "Could not install the Electron panel collection behavior override");
      return;
    case kPanelScreenUnavailable:
      napi_throw_error(env, "ERR_PANEL_SCREEN_UNAVAILABLE", "No screen is available for panel bounds");
      return;
    case kPanelOK:
      return;
  }
}

static napi_value invoke(napi_env env, napi_callback_info info) {
  napi_value args[6], result;
  size_t argc = 6;
  void *data;
  napi_get_cb_info(env, info, &argc, args, nullptr, &data);
  auto op = static_cast<Operation>(reinterpret_cast<uintptr_t>(data));
  if (!pthread_main_np()) {
    throw_panel_error(env, op, kPanelWrongThread);
    return nullptr;
  }
  const size_t counts[] = {1, 5, 1, 2, 1, 2, 1, 1, 2};
  if (argc != counts[op]) {
    napi_throw_type_error(env, nullptr, "Invalid panel argument count");
    return nullptr;
  }
  void *view = nullptr;
  bool flag = false, movable = false;
  double id = 0, values[4] = {};
  if (op != Configure && (!number(env, args[0], &id) || id != kToolbarPanel)) {
    napi_throw_type_error(env, nullptr, "Unknown selection panel id");
    return nullptr;
  }
  if ((op == Configure || op == Create) && !handle(env, args[op == Configure ? 0 : 1], &view)) {
    napi_throw_type_error(env, nullptr, "Expected a non-null macOS NSView handle buffer");
    return nullptr;
  }
  if (op == Show || op == Menu || op == Create) {
    size_t index = op == Create ? 2 : 1;
    if (!is_type(env, args[index], napi_boolean) ||
        napi_get_value_bool(env, args[index], &flag) != napi_ok ||
        (op == Create && (!is_type(env, args[3], napi_boolean) ||
          napi_get_value_bool(env, args[3], &movable) != napi_ok ||
          !is_type(env, args[4], napi_function)))) {
      napi_throw_type_error(env, nullptr, "Invalid panel options or callback");
      return nullptr;
    }
  }
  if (op == SetBounds) {
    const char *keys[] = {"x", "y", "width", "height"};
    if (!is_type(env, args[1], napi_object)) {
      napi_throw_type_error(env, nullptr, "Expected panel bounds");
      return nullptr;
    }
    for (size_t index = 0; index < 4; index++) {
      napi_value value;
      if (napi_get_named_property(env, args[1], keys[index], &value) != napi_ok ||
          !number(env, value, &values[index]) || (index >= 2 && values[index] <= 0)) {
        napi_throw_type_error(env, nullptr, "Expected finite panel bounds and positive dimensions");
        return nullptr;
      }
    }
  }
  DictolPanelStatus status = kPanelOK;
  switch (op) {
    case Configure: status = dictol_configure_electron_panel(view); break;
    case Create: {
      if (panelCallback) {
        napi_throw_error(env, nullptr, "Selection panel already exists");
        return nullptr;
      }
      napi_value name;
      napi_create_string_utf8(env, "SelectionPanel", NAPI_AUTO_LENGTH, &name);
      if (napi_create_threadsafe_function(env, args[4], nullptr, name, 0, 1, nullptr, nullptr,
                                         nullptr, deliver_event, &panelCallback) != napi_ok) {
        napi_throw_error(env, nullptr, "Could not create panel callback");
        return nullptr;
      }
      panelOwner = env;
      // An idle panel must not keep the Node environment alive.
      napi_unref_threadsafe_function(env, panelCallback);
      status = dictol_panel_create(kToolbarPanel, view, flag, movable, notify);
      if (status != kPanelOK) release_callback();
      break;
    }
    case Destroy:
      status = dictol_panel_destroy(kToolbarPanel);
      if (status == kPanelOK) release_callback();
      break;
    case Show: status = dictol_panel_show(kToolbarPanel, flag); break;
    case Hide: status = dictol_panel_hide(kToolbarPanel); break;
    case Menu: {
      bool selected;
      status = dictol_panel_show_disable_menu(kToolbarPanel, flag, &selected);
      if (status != kPanelOK) break;
      napi_get_boolean(env, selected, &result);
      return result;
    }
    case State: {
      unsigned int state;
      status = dictol_panel_state(kToolbarPanel, &state);
      if (status != kPanelOK) break;
      napi_create_uint32(env, state, &result);
      return result;
    }
    case Bounds: {
      status = dictol_panel_bounds(kToolbarPanel, values);
      if (status != kPanelOK) break;
      const char *keys[] = {"x", "y", "width", "height"};
      napi_create_object(env, &result);
      for (size_t index = 0; index < 4; index++) {
        napi_value value;
        napi_create_double(env, values[index], &value);
        napi_set_named_property(env, result, keys[index], value);
      }
      return result;
    }
    case SetBounds:
      status = dictol_panel_set_bounds(kToolbarPanel, values[0], values[1], values[2], values[3]); break;
  }
  if (status != kPanelOK) {
    throw_panel_error(env, op, status);
    return nullptr;
  }
  napi_get_undefined(env, &result);
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  const char *names[] = {"configureElectronPanel", "createSelectionPanel", "destroySelectionPanel",
    "showSelectionPanel", "hideSelectionPanel", "showSelectionPanelDisableMenu", "selectionPanelState",
    "getSelectionPanelBounds", "setSelectionPanelBounds"};
  for (uintptr_t index = 0; index < 9; index++) {
    napi_value function;
    napi_create_function(env, names[index], NAPI_AUTO_LENGTH, invoke,
                          reinterpret_cast<void *>(index), &function);
    napi_set_named_property(env, exports, names[index], function);
  }
  if (pthread_main_np()) napi_add_env_cleanup_hook(env, cleanup, env);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
