#define NAPI_VERSION 8
#include <node_api.h>

#include <stdint.h>
#include <string>
#include <vector>

extern "C" int dictol_recognize_mac_text(const uint8_t *png, size_t png_length,
                                         const char *language_list, int accurate,
                                         uint8_t **output, size_t *output_length);
extern "C" void dictol_free_mac_ocr_json(uint8_t *bytes);
extern "C" int dictol_chinese_word_range(const char *utf8, uint32_t offset,
                                         uint32_t *start, uint32_t *length);

struct OcrWork {
    napi_async_work work = nullptr;
    napi_deferred deferred = nullptr;
    std::vector<uint8_t> png;
    std::string languages;
    bool accurate = false;
    uint8_t *json = nullptr;
    size_t json_length = 0;
    int result = 0;
};

static napi_value make_error(napi_env env, const char *message) {
    napi_value text;
    napi_value error;
    napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text);
    napi_create_error(env, nullptr, text, &error);
    return error;
}

static bool read_string(napi_env env, napi_value value, std::string *output) {
    napi_valuetype type;
    if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return false;
    size_t length = 0;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
    std::vector<char> text(length + 1);
    if (napi_get_value_string_utf8(env, value, text.data(), text.size(), &length) != napi_ok) {
        return false;
    }
    output->assign(text.data(), length);
    return true;
}

static void execute_ocr(napi_env, void *data) {
    auto *work = static_cast<OcrWork *>(data);
    work->result = dictol_recognize_mac_text(
        work->png.data(), work->png.size(), work->languages.c_str(), work->accurate ? 1 : 0,
        &work->json, &work->json_length);
}

static void complete_ocr(napi_env env, napi_status status, void *data) {
    auto *work = static_cast<OcrWork *>(data);
    if (status == napi_ok && work->result && work->json) {
        napi_value json_text;
        napi_value global;
        napi_value json;
        napi_value parse;
        napi_value result;
        napi_status parsed = napi_create_string_utf8(
            env, reinterpret_cast<const char *>(work->json), work->json_length, &json_text);
        if (parsed == napi_ok) parsed = napi_get_global(env, &global);
        if (parsed == napi_ok) parsed = napi_get_named_property(env, global, "JSON", &json);
        if (parsed == napi_ok) parsed = napi_get_named_property(env, json, "parse", &parse);
        if (parsed == napi_ok) parsed = napi_call_function(env, json, parse, 1, &json_text, &result);
        if (parsed == napi_ok) {
            napi_resolve_deferred(env, work->deferred, result);
        } else {
            napi_value exception;
            if (napi_get_and_clear_last_exception(env, &exception) != napi_ok) {
                exception = make_error(env, "Invalid Vision OCR result");
            }
            napi_reject_deferred(env, work->deferred, exception);
        }
    } else {
        napi_reject_deferred(env, work->deferred,
            make_error(env, status == napi_ok ? "macOS Vision OCR failed"
                                         : "macOS Vision OCR was cancelled"));
    }
    if (work->json) dictol_free_mac_ocr_json(work->json);
    napi_delete_async_work(env, work->work);
    delete work;
}

static napi_value recognize_mac_text(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3];
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 3) {
        napi_throw_type_error(env, nullptr, "recognizeMacText expects png, languages, accurate");
        return nullptr;
    }

    bool is_buffer = false;
    bool is_array = false;
    bool accurate = false;
    napi_valuetype accurate_type;
    if (napi_is_buffer(env, argv[0], &is_buffer) != napi_ok || !is_buffer ||
        napi_is_array(env, argv[1], &is_array) != napi_ok || !is_array ||
        napi_typeof(env, argv[2], &accurate_type) != napi_ok || accurate_type != napi_boolean ||
        napi_get_value_bool(env, argv[2], &accurate) != napi_ok) {
        napi_throw_type_error(env, nullptr, "recognizeMacText expects (Buffer, string[], boolean)");
        return nullptr;
    }

    void *bytes;
    size_t length;
    if (napi_get_buffer_info(env, argv[0], &bytes, &length) != napi_ok || length == 0) {
        napi_throw_type_error(env, nullptr, "OCR screenshot must be a nonempty Buffer");
        return nullptr;
    }

    auto *work = new OcrWork{};
    auto *start = static_cast<uint8_t *>(bytes);
    work->png.assign(start, start + length);
    work->accurate = accurate;
    uint32_t count = 0;
    napi_get_array_length(env, argv[1], &count);
    for (uint32_t index = 0; index < count; index++) {
        napi_value entry;
        std::string language;
        if (napi_get_element(env, argv[1], index, &entry) != napi_ok ||
            !read_string(env, entry, &language) || language.find('\0') != std::string::npos) {
            delete work;
            napi_throw_type_error(env, nullptr, "OCR languages must be strings");
            return nullptr;
        }
        if (!work->languages.empty()) work->languages += ',';
        work->languages += language;
    }

    napi_value promise;
    napi_value resource_name;
    napi_create_promise(env, &work->deferred, &promise);
    napi_create_string_utf8(env, "recognizeMacText", NAPI_AUTO_LENGTH, &resource_name);
    napi_status queued = napi_create_async_work(
        env, nullptr, resource_name, execute_ocr, complete_ocr, work, &work->work);
    if (queued == napi_ok) queued = napi_queue_async_work(env, work->work);
    if (queued != napi_ok) {
        if (work->work) napi_delete_async_work(env, work->work);
        delete work;
        napi_throw_error(env, nullptr, "Could not schedule Vision OCR");
        return nullptr;
    }
    return promise;
}

static napi_value chinese_word_range(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2) {
        napi_throw_type_error(env, nullptr, "chineseWordRange expects text, offset");
        return nullptr;
    }
    std::string text;
    uint32_t offset;
    if (!read_string(env, argv[0], &text) ||
        napi_get_value_uint32(env, argv[1], &offset) != napi_ok) {
        napi_throw_type_error(env, nullptr, "chineseWordRange expects (string, number)");
        return nullptr;
    }
    uint32_t start = 0;
    uint32_t length = 0;
    if (text.find('\0') != std::string::npos ||
        !dictol_chinese_word_range(text.c_str(), offset, &start, &length)) {
        napi_value result;
        napi_get_null(env, &result);
        return result;
    }
    napi_value result;
    napi_value value;
    napi_create_object(env, &result);
    napi_create_uint32(env, start, &value);
    napi_set_named_property(env, result, "start", value);
    napi_create_uint32(env, length, &value);
    napi_set_named_property(env, result, "length", value);
    return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"recognizeMacText", nullptr, recognize_mac_text, nullptr, nullptr, nullptr,
         napi_default, nullptr},
        {"chineseWordRange", nullptr, chinese_word_range, nullptr, nullptr, nullptr,
         napi_default, nullptr}
    };
    napi_define_properties(env, exports, 2, properties);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
