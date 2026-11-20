#define NAPI_VERSION 8
#include <node_api.h>
#import "capture.h"
#import "ocr.h"
#import <ImageIO/ImageIO.h>
#include <cmath>
#include <chrono>
#include <string>

enum Operation { Displays, Windows, Region, Display, Window, PngOcr, RegionOcr };
struct OperationBinding {
    const char *name;
    Operation operation;
};
// 一次异步请求的输入和输出，按 JS 线程 → 工作线程 → JS 线程的顺序交接。
// png/items 由 ARC 管理；image 为自持有 CF 引用，在任务销毁时手动释放。
struct Work {
    Operation operation;
    napi_async_work work = nullptr;
    napi_deferred deferred;
    uint32_t identifier = 0;
    CGRect region = CGRectZero;
    std::string languages;
    NSData *png;
    NSArray *items;
    CGImageRef image = nullptr;
    std::string json, error;
    const char *error_code = nullptr;
    double capture_ms = 0, ocr_ms = 0;
    size_t width = 0, height = 0;
    ~Work() { if (image) CGImageRelease(image); }
};
static napi_value string(napi_env env, const char *value, size_t length = NAPI_AUTO_LENGTH) {
    napi_value result; napi_create_string_utf8(env, value, length, &result); return result;
}
static napi_value number(napi_env env, double value) {
    napi_value result; napi_create_double(env, value, &result); return result;
}
static napi_value object(napi_env env) { napi_value value; napi_create_object(env, &value); return value; }
static void set(napi_env env, napi_value obj, const char *key, napi_value value) {
    napi_set_named_property(env, obj, key, value);
}
static napi_value error_value(napi_env env, const char *message) {
    napi_value result; napi_create_error(env, nullptr, string(env, message), &result); return result;
}
// 属性 getter 也会执行 JS；若它已抛错，应保留原始异常，不能用参数错误覆盖。
static bool invalid(napi_env env, const char *message) {
    bool pending = false;
    napi_is_exception_pending(env, &pending);
    if (!pending) napi_throw_type_error(env, nullptr, message);
    return false;
}
static bool read_number(napi_env env, napi_value value, double &result) {
    return value && napi_get_value_double(env, value, &result) == napi_ok && std::isfinite(result);
}
static bool read_string(napi_env env, napi_value value, std::string &result) {
    size_t length;
    if (!value || napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
    result.resize(length + 1);
    if (napi_get_value_string_utf8(env, value, result.data(), length + 1, &length) != napi_ok) return false;
    result.resize(length);
    return true;
}
static bool read_rect(napi_env env, napi_value *args, CGRect &rect) {
    double values[4];
    for (int i = 0; i < 4; i++) if (!read_number(env, args[i], values[i])) return false;
    rect = CGRectMake(values[0], values[1], values[2], values[3]);
    return values[2] > 0 && values[3] > 0;
}
// 在 JS 线程校验语言列表，然后传递给后台识别任务。
static bool read_languages(napi_env env, Work *work, napi_value languages) {
    bool array = false; uint32_t count;
    if (!languages || napi_is_array(env, languages, &array) != napi_ok || !array ||
        napi_get_array_length(env, languages, &count) != napi_ok) return invalid(env, "OCR languages must be an array of strings");
    for (uint32_t i = 0; i < count; i++) {
        napi_value entry = nullptr; std::string language;
        // 数组元素可能是 getter；读取失败时不能继续使用输出句柄。
        if (napi_get_element(env, languages, i, &entry) != napi_ok)
            return invalid(env, "Could not read OCR language");
        if (!read_string(env, entry, language) || language.find(',') != std::string::npos || language.find('\0') != std::string::npos)
            return invalid(env, "OCR languages cannot contain commas or null characters");
        if (i) work->languages += ',';
        work->languages += language;
    }
    return true;
}
static double elapsed(std::chrono::steady_clock::time_point start) {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
}
// 将原生截图编码成 PNG，供 Node 调用方保存或传给独立的 OCR 接口。
static void encode_captured_image(Work *work) {
    NSMutableData *png = [NSMutableData data];
    CGImageDestinationRef dest = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)png, CFSTR("public.png"), 1, nullptr);
    if (!dest) { work->error = "Could not encode captured image as PNG"; return; }
    CGImageDestinationAddImage(dest, work->image, nullptr);
    bool success = CGImageDestinationFinalize(dest); CFRelease(dest);
    if (!success) work->error = "Could not encode captured image as PNG";
    else work->png = png;
    work->width = CGImageGetWidth(work->image); work->height = CGImageGetHeight(work->image);
}

// 接收并释放桥接层的 JSON 缓冲区；JSON 中的 OCR 错误由 JS 包装层抛出。
static void finish_ocr(Work *work, int success, uint8_t *bytes, size_t length) {
    if (success && bytes) work->json.assign((const char *)bytes, length);
    else work->error = "macOS Vision OCR failed";
    free_ocr_json(bytes);
}

static void execute_png_ocr(Work *work) {
    auto start = std::chrono::steady_clock::now();
    uint8_t *bytes = nullptr; size_t length = 0;
    int success = recognize_png((const uint8_t *)work->png.bytes, work->png.length,
        work->languages.c_str(), &bytes, &length);
    work->ocr_ms = elapsed(start);
    finish_ocr(work, success, bytes, length);
}

static void execute_list_displays(Work *work) {
    NSError *error = nil;
    work->items = list_displays(&error);
    if (error) work->error = error.localizedDescription.UTF8String;
}

static void execute_list_windows(Work *work) {
    NSError *error = nil;
    work->items = list_windows(&error);
    if (error) work->error = error.localizedDescription.UTF8String;
}

static void execute_capture_region(Work *work) {
    NSError *error = nil;
    auto start = std::chrono::steady_clock::now();
    work->image = capture_region(work->identifier, work->region, &error);
    work->capture_ms = elapsed(start);
    if (error) { work->error = error.localizedDescription.UTF8String; return; }
    encode_captured_image(work);
}

// 图像仅在本次任务中持有，不编码 PNG，也不向 JS 暴露图像句柄。
static void execute_region_ocr(Work *work) {
    NSError *error = nil;
    auto start = std::chrono::steady_clock::now();
    work->image = capture_region(work->identifier, work->region, &error);
    work->capture_ms = elapsed(start);
    if (error) {
        work->error = error.localizedDescription.UTF8String;
        work->error_code = "ERR_SCREEN_CAPTURE";
        return;
    }
    work->width = CGImageGetWidth(work->image);
    work->height = CGImageGetHeight(work->image);
    start = std::chrono::steady_clock::now();
    uint8_t *bytes = nullptr; size_t length = 0;
    int success = recognize_image(work->image, work->languages.c_str(), &bytes, &length);
    work->ocr_ms = elapsed(start);
    finish_ocr(work, success, bytes, length);
}

static void execute_capture_display(Work *work) {
    NSError *error = nil;
    auto start = std::chrono::steady_clock::now();
    work->image = capture_display(work->identifier, &error);
    work->capture_ms = elapsed(start);
    if (error) { work->error = error.localizedDescription.UTF8String; return; }
    encode_captured_image(work);
}

static void execute_capture_window(Work *work) {
    NSError *error = nil;
    auto start = std::chrono::steady_clock::now();
    work->image = capture_window(work->identifier, &error);
    work->capture_ms = elapsed(start);
    if (error) { work->error = error.localizedDescription.UTF8String; return; }
    encode_captured_image(work);
}

// Node 工作线程入口：统一自动释放池并分发任务；处理函数不再根据 Operation 切换行为。
// 所有处理函数只操作原生数据，不能在这里创建或访问 napi_value。
static void execute(napi_env, void *data) {
    auto *work = static_cast<Work *>(data);
    @autoreleasepool {
        switch (work->operation) {
            case Displays: execute_list_displays(work); break;
            case Windows: execute_list_windows(work); break;
            case Region: execute_capture_region(work); break;
            case Display: execute_capture_display(work); break;
            case Window: execute_capture_window(work); break;
            case PngOcr: execute_png_ocr(work); break;
            case RegionOcr: execute_region_ocr(work); break;
        }
    }
}
// 仅用于枚举结果中的数组、字典、字符串、数字和布尔值，不是通用 ObjC 对象转换器。
static napi_value to_js(napi_env env, id value) {
    if ([value isKindOfClass:NSArray.class]) {
        napi_value array; napi_create_array_with_length(env, [value count], &array);
        NSUInteger i = 0; for (id entry in value) napi_set_element(env, array, i++, to_js(env, entry));
        return array;
    }
    if ([value isKindOfClass:NSDictionary.class]) {
        napi_value obj = object(env);
        for (NSString *key in value) set(env, obj, key.UTF8String, to_js(env, value[key]));
        return obj;
    }
    if ([value isKindOfClass:NSString.class]) return string(env, [value UTF8String]);
    if (CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) {
        napi_value result; napi_get_boolean(env, [value boolValue], &result); return result;
    }
    return number(env, [value doubleValue]);
}
// 回到 JS 线程后组装结果、结算 Promise，并销毁 Work 及其原生资源。
static void complete(napi_env env, napi_status status, void *data) {
    auto *work = static_cast<Work *>(data);
    @autoreleasepool {
        if (status != napi_ok) work->error = "macOS capture/OCR task was cancelled";
        if (!work->error.empty()) {
            napi_value error = error_value(env, work->error.c_str());
            if (work->error_code) set(env, error, "code", string(env, work->error_code));
            napi_reject_deferred(env, work->deferred, error);
        }
        else {
            napi_value result;
            if (work->operation == Displays || work->operation == Windows) result = to_js(env, work->items);
            else if (work->operation == PngOcr) result = string(env, work->json.data(), work->json.size());
            else {
                result = object(env);
                set(env, result, "width", number(env, work->width)); set(env, result, "height", number(env, work->height));
                if (work->operation == RegionOcr) {
                    set(env, result, "json", string(env, work->json.data(), work->json.size()));
                } else {
                    napi_value buffer;
                    napi_create_buffer_copy(env, work->png.length, work->png.bytes, nullptr, &buffer);
                    set(env, result, "png", buffer);
                }
            }
            napi_resolve_deferred(env, work->deferred, result);
        }
        napi_delete_async_work(env, work->work); delete work;
    }
}
// 共用的 Node 入口：由注册时的回调数据选择操作，校验成功后才创建异步任务。
static napi_value invoke(napi_env env, napi_callback_info info) {
    @autoreleasepool {
    napi_value args[6] = {}; size_t argc = 6; void *operation;
    napi_get_cb_info(env, info, &argc, args, nullptr, &operation);
    const auto *binding = static_cast<const OperationBinding *>(operation);
    auto *work = new Work{};
    work->operation = binding->operation;
    bool valid = true;
    if (work->operation == Region || work->operation == Display ||
        work->operation == Window || work->operation == RegionOcr) {
        double identifier;
        if (!read_number(env, args[0], identifier) || identifier < 1 || identifier > UINT32_MAX || floor(identifier) != identifier)
            valid = invalid(env, "Invalid display or window ID");
        else work->identifier = (uint32_t)identifier;
        if (valid && (work->operation == Region || work->operation == RegionOcr) && !read_rect(env, args + 1, work->region))
            valid = invalid(env, "Invalid screen region");
        if (valid && work->operation == RegionOcr) valid = read_languages(env, work, args[5]);
    } else if (work->operation == PngOcr) {
        // 校验后复制输入，避免异步识别期间 JS 修改 Buffer 导致数据变化。
        bool buffer = false; void *bytes; size_t length;
        if (!args[0] || napi_is_buffer(env, args[0], &buffer) != napi_ok || !buffer ||
            napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok || !length)
            valid = invalid(env, "OCR screenshot must be a nonempty Buffer");
        else work->png = [NSData dataWithBytes:bytes length:length];
        if (valid) valid = read_languages(env, work, args[1]);
    }
    if (!valid) { delete work; return nullptr; }
    napi_value promise;
    napi_create_promise(env, &work->deferred, &promise);
    napi_status status = napi_create_async_work(env, nullptr, string(env, "macOS capture/OCR"), execute, complete, work, &work->work);
    if (status == napi_ok) {
        status = napi_queue_async_work(env, work->work);
    }
    if (status != napi_ok) {
        if (work->work) napi_delete_async_work(env, work->work);
        delete work; napi_throw_error(env, nullptr, "Could not schedule macOS capture/OCR task"); return nullptr;
    }
    return promise;
    }
}
// 权限预检仅提供提示，实际能否截图仍以 ScreenCaptureKit 调用结果为准。
static napi_value permission(napi_env env, napi_callback_info) {
    napi_value result; napi_get_boolean(env, CGPreflightScreenCaptureAccess(), &result); return result;
}
static napi_value word_range(napi_env env, napi_callback_info info) {
    napi_value args[2] = {}; size_t argc = 2; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    std::string text; double offset;
    if (!read_string(env, args[0], text) || text.find('\0') != std::string::npos || !read_number(env, args[1], offset) ||
        offset < 0 || offset > UINT32_MAX || floor(offset) != offset) {
        invalid(env, "chineseWordRange expects text and a UTF-16 offset"); return nullptr;
    }
    uint32_t start, length;
    if (!chinese_word_range(text.c_str(), (uint32_t)offset, &start, &length)) {
        napi_value result; napi_get_null(env, &result); return result;
    }
    napi_value result = object(env); set(env, result, "start", number(env, start)); set(env, result, "length", number(env, length)); return result;
}
// 显式绑定名称与操作，不依赖枚举值和导出列表的排列顺序。
static napi_value initialize(napi_env env, napi_value exports) {
    // 回调数据引用此表，因此表项须在异步调用之外持续有效。
    static const OperationBinding operations[] = {
        {"listShareableDisplays", Displays},
        {"listShareableWindows", Windows},
        {"captureScreenRegion", Region},
        {"captureDisplay", Display},
        {"captureWindow", Window},
        {"captureAndRecognizeMacText", RegionOcr},
        {"recognizeMacPng", PngOcr}
    };
    for (const auto &entry : operations) {
        napi_value fn;
        napi_create_function(env, entry.name, NAPI_AUTO_LENGTH, invoke,
                             const_cast<OperationBinding *>(&entry), &fn);
        set(env, exports, entry.name, fn);
    }
    const struct {
        const char *name;
        napi_callback callback;
    } callbacks[] = {
        {"hasScreenCapturePermission", permission},
        {"chineseWordRange", word_range}
    };
    for (const auto &entry : callbacks) {
        napi_value fn;
        napi_create_function(env, entry.name, NAPI_AUTO_LENGTH, entry.callback, nullptr, &fn);
        set(env, exports, entry.name, fn);
    }
    return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
