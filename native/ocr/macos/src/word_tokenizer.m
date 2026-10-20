#import <Foundation/Foundation.h>
#import <NaturalLanguage/NaturalLanguage.h>
#include <stdint.h>

int dictol_chinese_word_range(const char *utf8, uint32_t offset, uint32_t *start, uint32_t *length) {
    @autoreleasepool {
        if (!utf8 || !start || !length) return 0;
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
