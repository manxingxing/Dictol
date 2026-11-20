#pragma once
#include <CoreGraphics/CoreGraphics.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// 识别入口由绑定层 execute 调用，复用调用方的 autoreleasepool。
// 同步调用，PNG 字节和逗号分隔的 UTF-8 语言列表均只在调用期间借用。
// 识别时开启 Vision 自动语言检测。
// 返回 1 表示已生成 UTF-8 JSON（也可能是 OCR 错误对象），0 表示桥接失败。
// 成功生成的 *output 归调用方所有，须用 free_ocr_json 释放。
// image 只在同步识别期间借用；截图调用方负责释放它。
int recognize_image(CGImageRef image, const char *language_list,
                    uint8_t **output, size_t *output_length);
int recognize_png(const uint8_t *png, size_t png_length,
                  const char *language_list, uint8_t **output, size_t *output_length);
void free_ocr_json(uint8_t *bytes);

// 借用以 null 结尾的 UTF-8 文本；offset/start/length 使用 UTF-16 单元，与 JS 字符串一致。
// 找到单词时返回 1 并写入范围，否则返回 0；不向调用方转移任何对象。
int chinese_word_range(const char *utf8, uint32_t offset, uint32_t *start, uint32_t *length);

#ifdef __cplusplus
}
#endif
