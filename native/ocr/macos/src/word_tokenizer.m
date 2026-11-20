#import "ocr.h"
#import <Foundation/Foundation.h>
#import <NaturalLanguage/NaturalLanguage.h>
#include <stdint.h>

// 用 NaturalLanguage 找到 offset 所在的词；名称沿用中文分词接口，也可处理其他语言。
int chinese_word_range(const char *utf8, uint32_t offset, uint32_t *start, uint32_t *length) {
    // 此同步导出不经过 execute，由本函数提供释放池。
    @autoreleasepool {
        if (!utf8 || !start || !length) return 0;
        // UTF-8 只用于跨语言传参；转换为 NSString 后按 UTF-16 偏移定位，与 JS 保持一致。
        NSString *text = [NSString stringWithUTF8String:utf8];
        if (!text || offset >= text.length) return 0;

        NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitWord];
        tokenizer.string = text;
        NSRange range = [tokenizer tokenRangeAtIndex:offset];
        if (range.location == NSNotFound || range.length == 0) return 0;

        *start = (uint32_t)range.location;
        *length = (uint32_t)range.length;
        return 1;
    }
}
