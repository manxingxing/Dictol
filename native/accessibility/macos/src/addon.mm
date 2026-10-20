#define NAPI_VERSION 8
#include <node_api.h>

#include <stdint.h>
#include <stdlib.h>

extern "C" int dictol_read_mac_accessible_text(double x, double y, int include_context,
                                                 uint8_t **output, size_t *output_length);
extern "C" void dictol_free_mac_accessible_text(uint8_t *bytes);

struct AccessibilityWork {
    napi_async_work work;
    napi_deferred deferred;
    double x;
    double y;
    bool include_context;
    uint8_t *json;
    size_t json_length;
    int result;
};

static napi_value make_error(napi_env env, const char *message) {
    napi_value text;
    napi_value error;
    napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text);
    napi_create_error(env, nullptr, text, &error);
    return error;
}

static void execute_lookup(napi_env, void *data) {
    auto *work = static_cast<AccessibilityWork *>(data);
    work->result = dictol_read_mac_accessible_text(
        work->x, work->y, work->include_context ? 1 : 0, &work->json, &work->json_length);
}

static void complete_lookup(napi_env env, napi_status status, void *data) {
    auto *work = static_cast<AccessibilityWork *>(data);
    if (status == napi_ok && work->result && work->json) {
        napi_value json_text;
        napi_value global;
        napi_value json;
        napi_value parse;
        napi_value result;
        napi_status parse_status = napi_create_string_utf8(
            env, reinterpret_cast<const char *>(work->json), work->json_length, &json_text);
        if (parse_status == napi_ok) parse_status = napi_get_global(env, &global);
        if (parse_status == napi_ok) parse_status = napi_get_named_property(env, global, "JSON", &json);
        if (parse_status == napi_ok) parse_status = napi_get_named_property(env, json, "parse", &parse);
        if (parse_status == napi_ok) {
            parse_status = napi_call_function(env, json, parse, 1, &json_text, &result);
        }
        if (parse_status == napi_ok) {
            napi_resolve_deferred(env, work->deferred, result);
        } else {
            napi_reject_deferred(env, work->deferred, make_error(env, "Invalid Accessibility result"));
        }
    } else {
        napi_reject_deferred(env, work->deferred,
                             make_error(env, status == napi_ok
                                 ? "macOS Accessibility lookup failed"
                                 : "macOS Accessibility lookup was cancelled"));
    }

    if (work->json) dictol_free_mac_accessible_text(work->json);
    napi_delete_async_work(env, work->work);
    delete work;
}

static napi_value read_accessible_text(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3];
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 3) {
        napi_throw_type_error(env, nullptr, "readAccessibleText expects x, y, includeContext");
        return nullptr;
    }

    auto *work = new AccessibilityWork{};
    napi_valuetype x_type;
    napi_valuetype y_type;
    napi_valuetype context_type;
    if (napi_typeof(env, argv[0], &x_type) != napi_ok || x_type != napi_number ||
        napi_typeof(env, argv[1], &y_type) != napi_ok || y_type != napi_number ||
        napi_typeof(env, argv[2], &context_type) != napi_ok || context_type != napi_boolean ||
        napi_get_value_double(env, argv[0], &work->x) != napi_ok ||
        napi_get_value_double(env, argv[1], &work->y) != napi_ok ||
        napi_get_value_bool(env, argv[2], &work->include_context) != napi_ok) {
        delete work;
        napi_throw_type_error(env, nullptr, "readAccessibleText expects (number, number, boolean)");
        return nullptr;
    }

    napi_value promise;
    napi_value resource_name;
    napi_create_promise(env, &work->deferred, &promise);
    napi_create_string_utf8(env, "readAccessibleText", NAPI_AUTO_LENGTH, &resource_name);
    napi_status result = napi_create_async_work(
        env, nullptr, resource_name, execute_lookup, complete_lookup, work, &work->work);
    if (result == napi_ok) result = napi_queue_async_work(env, work->work);
    if (result != napi_ok) {
        if (work->work) napi_delete_async_work(env, work->work);
        delete work;
        napi_throw_error(env, nullptr, "Could not schedule macOS Accessibility lookup");
        return nullptr;
    }
    return promise;
}

static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"readAccessibleText", nullptr, read_accessible_text, nullptr, nullptr, nullptr,
         napi_default, nullptr}
    };
    napi_define_properties(env, exports, 1, properties);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
