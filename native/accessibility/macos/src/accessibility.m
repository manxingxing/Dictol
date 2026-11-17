#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <NaturalLanguage/NaturalLanguage.h>
#include <dispatch/dispatch.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// 判断屏幕坐标处最前面的窗口是否属于当前进程。
// An AX hit test against our own window calls Electron's accessibilityHitTest
// in this process. That callback must run on the AppKit main thread.
static BOOL point_is_inside_own_window(double x, double y) {
    CFArrayRef windows = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID);
    if (!windows) return NO;
    BOOL inside = NO;
    CGPoint point = CGPointMake(x, y);
    for (CFIndex index = 0; index < CFArrayGetCount(windows); index++) {
        CFDictionaryRef window = (CFDictionaryRef)CFArrayGetValueAtIndex(windows, index);
        CFDictionaryRef bounds_value = (CFDictionaryRef)CFDictionaryGetValue(window, kCGWindowBounds);
        CGRect bounds = CGRectZero;
        if (bounds_value && CGRectMakeWithDictionaryRepresentation(bounds_value, &bounds) &&
            CGRectContainsPoint(bounds, point)) {
            CFNumberRef owner = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowOwnerPID);
            int pid = 0;
            inside = owner && CFNumberGetValue(owner, kCFNumberIntType, &pid) && pid == getpid();
            break;
        }
    }
    CFRelease(windows);
    return inside;
}

// Transfer an owned JSON buffer to the N-API bridge without a trailing NUL.
static int copy_json(id value, uint8_t **output, size_t *output_length) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    if (!json) return 0;
    uint8_t *bytes = malloc(json.length);
    if (!bytes) return 0;
    memcpy(bytes, json.bytes, json.length);
    *output = bytes;
    *output_length = json.length;
    return 1;
}

// Internal match: retain the text node until context expansion is complete.
@interface DictolTextMatch : NSObject
@property(nonatomic, strong) id element;
@property(nonatomic, copy) NSString *role;
@property(nonatomic, copy) NSString *value;
@property(nonatomic, copy) NSString *text;
@property(nonatomic) NSUInteger offset;
@property(nonatomic) BOOL direct;
@property(nonatomic) NSRange word;
@property(nonatomic) CGRect bounds;
@end
@implementation DictolTextMatch
@end

static DictolTextMatch *matched_word(AXUIElementRef element, NSString *text,
                                     NSUInteger offset, NSRange word, CGRect bounds) {
    DictolTextMatch *match = [DictolTextMatch new];
    match.element = (__bridge id)element;
    match.text = text;
    match.offset = offset;
    match.word = word;
    match.bounds = bounds;
    return match;
}

// AX and NSString ranges use UTF-16 offsets. Keep a window around the hit and
// report its start so callers can translate back to the element's coordinates.
static NSString *text_near_position(AXUIElementRef element, NSString *text, CFIndex position,
                                    CFIndex before, CFIndex window_length, CFIndex *window_start) {
    CFTypeRef count_value = NULL;
    // The total number of characters in the editable text element represented by this accessibility object.
    if (AXUIElementCopyAttributeValue(element, kAXNumberOfCharactersAttribute, &count_value)
            == kAXErrorSuccess && count_value) {
        CFIndex count = 0;
        if (CFGetTypeID(count_value) == CFNumberGetTypeID()) {
            CFNumberGetValue(count_value, kCFNumberCFIndexType, &count);
        }
        CFRelease(count_value);
        if (count > position) {
            CFIndex start = MAX(0, position - before);
            CFRange range = CFRangeMake(start, MIN(count - start, window_length));
            AXValueRef parameter = AXValueCreate(kAXValueCFRangeType, &range);
            CFTypeRef value = NULL;
            AXError error = parameter
                ? AXUIElementCopyParameterizedAttributeValue(
                      element, kAXStringForRangeParameterizedAttribute, parameter, &value)
                : kAXErrorFailure;
            if (parameter) CFRelease(parameter);
            if (error == kAXErrorSuccess && value) {
                if (CFGetTypeID(value) == CFStringGetTypeID()) {
                    *window_start = start;
                    return (__bridge_transfer NSString *)value;
                }
                CFRelease(value);
            }
        }
    } else if (count_value) {
        CFRelease(count_value);
    }

    // Reuse the value already read for this candidate if string-for-range is unavailable.
    if (position >= text.length) return nil;
    CFIndex start = MAX(0, position - before);
    *window_start = start;
    return [text substringWithRange:NSMakeRange(start, MIN(text.length - start, window_length))];
}

static BOOL is_ascii_compound_character(unichar character) {
    return (character >= 'A' && character <= 'Z') ||
           (character >= 'a' && character <= 'z') ||
           (character >= '0' && character <= '9') ||
           character == '_' || character == '-' || character == '\'' || character == 0x2019;
}

// 返回字符所属的单词范围
static NSRange word_range(NSString *text, NSUInteger offset) {
    NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitWord];
    tokenizer.string = text;
    NSRange range = [tokenizer tokenRangeAtIndex:offset];
    if (range.location == NSNotFound || range.length == 0 || NSMaxRange(range) > text.length ||
        offset < range.location || offset >= NSMaxRange(range)) return NSMakeRange(NSNotFound, 0);

    // Expand the tokenizer token across ASCII compound characters, then trim edge separators.
    unichar first = [text characterAtIndex:range.location];
    if (is_ascii_compound_character(first)) {
        NSUInteger start = range.location;
        NSUInteger end = NSMaxRange(range);
        while (start > 0 && is_ascii_compound_character([text characterAtIndex:start - 1])) start--;
        while (end < text.length && is_ascii_compound_character([text characterAtIndex:end])) end++;
        while (start < end && ![[NSCharacterSet alphanumericCharacterSet]
                                  characterIsMember:[text characterAtIndex:start]]) start++;
        while (end > start && ![[NSCharacterSet alphanumericCharacterSet]
                                  characterIsMember:[text characterAtIndex:end - 1]]) end--;
        range = NSMakeRange(start, end - start);
    }
    return range.length ? range : NSMakeRange(NSNotFound, 0);
}

// 文本范围 → 屏幕矩形
static BOOL bounds_for_range(AXUIElementRef element, CFRange range, CGRect *bounds, NSString **failure) {
    AXValueRef parameter = AXValueCreate(kAXValueCFRangeType, &range);
    if (!parameter) {
        if (failure) *failure = @"word-range-value";
        return NO;
    }
    CFTypeRef value = NULL;
    AXError error = AXUIElementCopyParameterizedAttributeValue(
        element, kAXBoundsForRangeParameterizedAttribute, parameter, &value);
    CFRelease(parameter);
    if (error != kAXErrorSuccess || !value) {
        if (value) CFRelease(value);
        if (failure) *failure = [NSString stringWithFormat:@"bounds-for-range:%d", error];
        return NO;
    }
    BOOL valid = CFGetTypeID(value) == AXValueGetTypeID() &&
                 AXValueGetType(value) == kAXValueCGRectType &&
                 AXValueGetValue(value, kAXValueCGRectType, bounds) &&
                 bounds->size.width > 0 && bounds->size.height > 0;
    CFRelease(value);
    if (!valid && failure) *failure = @"invalid-word-bounds";
    return valid;
}

static BOOL bounds_for_character(AXUIElementRef element, NSRange character,
                                 CFIndex window_start, CGRect *bounds) {
    return bounds_for_range(element,
                            CFRangeMake(window_start + character.location, character.length),
                            bounds, NULL);
}

// 多行词的外接矩形会把无关文本也框进来，不能直接用于高亮或弹窗定位。
// 这里用逐字符矩形确认指针确实落在词上，并把 *bounds 收敛到指针所在的那一行。
//
// 返回 YES 表示指针落在词上，*bounds 为命中行矩形；返回 NO 表示指针只在词的
// 外接框内、但不在任何字符上（例如跨行词两行之间的空白）。
//
// 统一使用 6pt 容差：AX 返回的字符框受字体度量影响，与鼠标坐标常有 1~2pt 偏差。
static BOOL word_bounds_at_point(AXUIElementRef element, NSString *text, NSRange word,
                                 CFIndex window_start, CGPoint point, CGRect *bounds) {
    // 1. 快速拒绝：指针不在词的外接框（外扩 6pt）内，后面不必再查。
    if (!CGRectContainsPoint(CGRectInset(*bounds, -6, -6), point)) return NO;

    // 2. 按字素簇取首尾字符，避免把 emoji、组合字符从中间拆开；
    //    首尾相同说明是单字符词，词框已经是最终结果。
    NSRange first = [text rangeOfComposedCharacterSequenceAtIndex:word.location];
    NSRange last = [text rangeOfComposedCharacterSequenceAtIndex:NSMaxRange(word) - 1];
    if (NSEqualRanges(first, last)) return YES;

    // 3. 首尾字符框都取到才能判断是否单行。任一查询失败时保留已通过词框校验的
    //    结果（YES），避免因为部分应用不支持逐字符查询而误杀。
    CGRect first_bounds = CGRectZero, last_bounds = CGRectZero;
    if (!bounds_for_character(element, first, window_start, &first_bounds) ||
        !bounds_for_character(element, last, window_start, &last_bounds)) return YES;
    // 首尾字符的 Y 区间重叠，说明整个词在同一行，外接框已经够用。
    if (CGRectGetMinY(first_bounds) < CGRectGetMaxY(last_bounds) &&
        CGRectGetMinY(last_bounds) < CGRectGetMaxY(first_bounds)) return YES;

    // 4. 跨行词：逐个字符取框，同时找出第一个包含指针的字符框。
    //    外接框可能覆盖多行，只有指针命中的字符才能确定它到底在哪一行。
    NSMutableArray<NSValue *> *rectangles = [NSMutableArray array];
    CGRect hit = CGRectNull;
    for (NSUInteger index = word.location; index < NSMaxRange(word);) {
        NSRange character = [text rangeOfComposedCharacterSequenceAtIndex:index];
        // 首尾字符复用上面已取到的框，避免重复 AX 调用；其余字符各查一次。
        CGRect character_bounds = CGRectZero;
        BOOL valid = YES;
        if (NSEqualRanges(character, first)) {
            character_bounds = first_bounds;
        } else if (NSEqualRanges(character, last)) {
            character_bounds = last_bounds;
        } else {
            valid = bounds_for_character(element, character, window_start, &character_bounds);
        }
        if (valid) {
            [rectangles addObject:[NSValue valueWithRect:character_bounds]];
            // 只记录第一个命中的字符；指针同时落在多个框内时按文档顺序取第一个。
            if (CGRectIsNull(hit) &&
                CGRectContainsPoint(CGRectInset(character_bounds, -6, -6), point)) {
                hit = character_bounds;
            }
        }
        index = NSMaxRange(character);
    }
    // 指针在词的大框内却不在任何字符上：多半是跨行词的行间空白或相邻文本，拒绝。
    if (CGRectIsNull(hit)) return NO;

    // 5. 只合并与命中字符同一行的字符框。起始值 CGRectNull 在 CGRectUnion 中
    //    视为空矩形，第一次并集就是该字符框本身。
    CGRect line_bounds = CGRectNull;
    for (NSValue *value in rectangles) {
        CGRect rectangle = value.rectValue;
        if (CGRectGetMinY(rectangle) < CGRectGetMaxY(hit) &&
            CGRectGetMinY(hit) < CGRectGetMaxY(rectangle)) {
            line_bounds = CGRectUnion(line_bounds, rectangle);
        }
    }
    // 6. 用命中行矩形替换词的外接框。
    *bounds = line_bounds;
    return YES;
}

// Normal lookups need only the word and bounds; AI lookups also need the
// surrounding text and the UTF-16 offset used for sentence extraction.
static NSDictionary *lookup_result(NSString *text, NSRange word, CGRect bounds) {
    return @{
        @"word": [text substringWithRange:word],
        @"x": @(bounds.origin.x),
        @"y": @(bounds.origin.y),
        @"width": @(bounds.size.width),
        @"height": @(bounds.size.height)
    };
}

// Preserve UTF-16 offsets while treating line breaks inside a text node as spaces.
static NSString *normalize_static_text(NSString *text) {
    return [text stringByReplacingOccurrencesOfString:@"\n" withString:@" "];
}

// Chromium may return an empty AXRangeForPosition for static text. Scan token
// rectangles, then validate the expanded word; offset remains the token start.
static DictolTextMatch *text_by_word_bounds(AXUIElementRef element, NSString *text, CGPoint point) {
    if (text.length == 0 || text.length > 8192) return nil;

    NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitWord];
    tokenizer.string = text;
    __block DictolTextMatch *hit = nil;
    [tokenizer enumerateTokensInRange:NSMakeRange(0, text.length)
                          usingBlock:^(NSRange token, NLTokenizerAttributes flags, BOOL *stop) {
        if (token.length == 0 || NSMaxRange(token) > text.length) return;
        CFRange token_range = CFRangeMake(token.location, token.length);
        CGRect token_bounds = CGRectZero;
        if (!bounds_for_range(element, token_range, &token_bounds, NULL)) return;
        if (!CGRectContainsPoint(CGRectInset(token_bounds, -3, -3), point)) return;

        NSRange word = word_range(text, token.location);
        if (word.location == NSNotFound) return;
        CFRange global_word = CFRangeMake(word.location, word.length);
        CGRect bounds = token_bounds;
        if (!NSEqualRanges(token, word) &&
            !bounds_for_range(element, global_word, &bounds, NULL)) return;
        if (!word_bounds_at_point(element, text, word, 0, point, &bounds)) return;
        hit = matched_word(element, text, token.location, word, bounds);
        *stop = YES;
    }];
    return hit;
}

// Resolve the character at the point to a word and verify its screen rectangle.
static DictolTextMatch *word_at_point(AXUIElementRef element, NSString *value, CGPoint point,
                                   AXError *position_error, NSString **failure) {
    if (!value.length) {
        *failure = @"text-unavailable";
        return nil;
    }
    AXValueRef position = AXValueCreate(kAXValueCGPointType, &point);
    if (!position) {
        *failure = @"position-value";
        return nil;
    }
    CFTypeRef range_value = NULL;
    // get the AXRangeForPosition for the point, which is the character index in the text
    // 并非所有元素都支持这个查询
    AXError error = AXUIElementCopyParameterizedAttributeValue(
        element, kAXRangeForPositionParameterizedAttribute, position, &range_value);
    *position_error = error;
    CFRelease(position);
    if (error != kAXErrorSuccess || !range_value) {
        if (range_value) CFRelease(range_value);
        *failure = [NSString stringWithFormat:@"range-for-position:%d", error];
        return nil;
    }
    // glyph 是光标下字符的位置
    CFRange glyph = CFRangeMake(0, 0);
    BOOL valid_range = CFGetTypeID(range_value) == AXValueGetTypeID() &&
                       AXValueGetType(range_value) == kAXValueCFRangeType &&
                       AXValueGetValue(range_value, kAXValueCFRangeType, &glyph);
    CFRelease(range_value);
    if (!valid_range || glyph.location < 0 || glyph.length <= 0 || glyph.location >= value.length) {
        *failure = @"invalid-character-range";
        return nil;
    }

    // get the word range that contains the character at glyph.location
    NSRange word = word_range(value, (NSUInteger)glyph.location);
    if (word.location == NSNotFound) {
        *failure = @"word-unavailable";
        return nil;
    }

    CFRange global_word = CFRangeMake(word.location, word.length);
    CGRect bounds = CGRectZero;
    if (!bounds_for_range(element, global_word, &bounds, failure)) return nil;
    // 处理跨行词：逐字符取框，收敛到指针所在的那一行
    if (!word_bounds_at_point(element, value, word, 0, point, &bounds)) {
        *failure = @"word-bounds-miss-pointer";
        return nil;
    }

    DictolTextMatch *match = matched_word(element, value, (NSUInteger)glyph.location, word, bounds);
    match.direct = YES;
    return match;
}

static NSString *string_attribute(AXUIElementRef element, CFStringRef attribute) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) {
        if (value) CFRelease(value);
        return nil;
    }
    if (CFGetTypeID(value) != CFStringGetTypeID()) {
        CFRelease(value);
        return nil;
    }
    return (__bridge_transfer NSString *)value;
}

// Shared across both hit tests for one hover lookup.
static const CFIndex max_lookup_nodes = 100;

static BOOL admit_lookup_node(CFMutableSetRef nodes, AXUIElementRef element) {
    if (!nodes || CFSetContainsValue(nodes, element)) return YES;
    if (CFSetGetCount(nodes) >= max_lookup_nodes) return NO;
    CFSetAddValue(nodes, element);
    return YES;
}

// Chrome can split one paragraph into several AXStaticText nodes at a style
// boundary. Read the nearest inline container while retaining the hit node's
// word rectangle and its UTF-16 character offset.
static BOOL append_inline_text(AXUIElementRef element, AXUIElementRef target, NSString *target_text,
                               NSMutableString *text, NSUInteger depth,
                               NSUInteger *visited, NSUInteger *leaves,
                               NSUInteger *target_start) {
    if (++*visited > 64 || depth > 4) return NO;
    NSString *role = string_attribute(element, kAXRoleAttribute);
    if ([role isEqualToString:@"AXStaticText"]) {
        NSString *value = CFEqual(element, target) ? target_text : string_attribute(element, kAXValueAttribute);
        if (!value || text.length + value.length > 8192) return NO;
        if (CFEqual(element, target)) *target_start = text.length;
        [text appendString:normalize_static_text(value)];
        (*leaves)++;
        return YES;
    }
    if ([role isEqualToString:@"AXLineBreak"]) {
        [text appendString:@"\n"];
        return YES;
    }
    if (![role isEqualToString:@"AXGroup"] && ![role isEqualToString:@"AXLink"]) return NO;
    if (depth > 0 && [role isEqualToString:@"AXGroup"] &&
        ![string_attribute(element, kAXSubroleAttribute) hasSuffix:@"StyleGroup"]) return NO;

    CFTypeRef children_value = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &children_value)
            != kAXErrorSuccess || !children_value) {
        if (children_value) CFRelease(children_value);
        return NO;
    }
    if (CFGetTypeID(children_value) != CFArrayGetTypeID()) {
        CFRelease(children_value);
        return NO;
    }
    CFArrayRef children = (CFArrayRef)children_value;
    // Do not return partially combined text when a child cannot be represented.
    BOOL complete = CFArrayGetCount(children) > 0;
    for (CFIndex index = 0; complete && index < CFArrayGetCount(children); index++) {
        CFTypeRef child = CFArrayGetValueAtIndex(children, index);
        complete = child && CFGetTypeID(child) == AXUIElementGetTypeID() &&
            append_inline_text((AXUIElementRef)child, target, target_text, text, depth + 1,
                               visited, leaves, target_start);
    }
    CFRelease(children);
    return complete;
}

// Merge only a complete hit-node value so its offset remains valid after
// preceding sibling text is added.
static NSDictionary *with_inline_context(AXUIElementRef target, NSDictionary *result, NSString *value) {
    NSString *target_text = normalize_static_text(value);
    if (!target_text || ![target_text isEqualToString:result[@"text"]]) return result;
    NSUInteger target_offset = [result[@"offset"] unsignedIntegerValue];
    if (target_offset >= target_text.length) return result;

    AXUIElementRef current = target;
    CFRetain(current);
    for (int depth = 0; depth < 3; depth++) {
        CFTypeRef parent_value = NULL;
        AXError error = AXUIElementCopyAttributeValue(current, kAXParentAttribute, &parent_value);
        if (error != kAXErrorSuccess || !parent_value ||
            CFGetTypeID(parent_value) != AXUIElementGetTypeID()) {
            if (parent_value) CFRelease(parent_value);
            break;
        }
        CFRelease(current);
        current = (AXUIElementRef)parent_value;
        NSMutableString *text = [NSMutableString string];
        NSUInteger visited = 0, leaves = 0, target_start = NSNotFound;
        if (append_inline_text(current, target, target_text, text, 0, &visited, &leaves, &target_start) &&
            leaves > 1 && target_start != NSNotFound) {
            NSMutableDictionary *combined = [result mutableCopy];
            combined[@"text"] = text;
            combined[@"offset"] = @(target_start + target_offset);
            CFRelease(current);
            return combined;
        }
        NSString *subrole = string_attribute(current, kAXSubroleAttribute);
        if (![subrole hasSuffix:@"StyleGroup"]) break;
    }
    CFRelease(current);
    return result;
}

// CGRectNull means the element did not provide a usable screen rectangle.
static CGRect element_bounds(AXUIElementRef element) {
    CFArrayRef values = NULL;
    NSArray *attributes = @[(__bridge NSString *)kAXPositionAttribute,
                            (__bridge NSString *)kAXSizeAttribute];
    AXError error = AXUIElementCopyMultipleAttributeValues(element, (__bridge CFArrayRef)attributes,
                                                          0, &values);
    CGPoint position = CGPointZero;
    CGSize size = CGSizeZero;
    CFTypeRef position_value = NULL, size_value = NULL;
    if (error == kAXErrorSuccess && values && CFArrayGetCount(values) == 2) {
        position_value = CFArrayGetValueAtIndex(values, 0);
        size_value = CFArrayGetValueAtIndex(values, 1);
    }
    BOOL valid =
                 position_value && size_value &&
                 CFGetTypeID(position_value) == AXValueGetTypeID() &&
                 CFGetTypeID(size_value) == AXValueGetTypeID() &&
                 AXValueGetType(position_value) == kAXValueCGPointType &&
                 AXValueGetType(size_value) == kAXValueCGSizeType &&
                 AXValueGetValue(position_value, kAXValueCGPointType, &position) &&
                 AXValueGetValue(size_value, kAXValueCGSizeType, &size) &&
                 size.width > 0 && size.height > 0;
    if (values) CFRelease(values);
    return valid ? (CGRect){position, size} : CGRectNull;
}

// Roles whose AXValue is rendered text and may need the token-bounds fallback when
// Chromium returns an empty AXRangeForPosition. Containers (AXGroup, AXLink, AXCell)
// stay out so their value cannot shadow a leaf text node in BFS order.
static BOOL is_text_role(NSString *role) {
    return [role isEqualToString:@"AXStaticText"] ||
           [role isEqualToString:@"AXTextArea"] ||
           [role isEqualToString:@"AXTextField"] ||
           [role isEqualToString:@"AXComboBox"];
}

// All candidates use direct character positioning first. The token-bounds fallback is
// a workaround for text roles (Chromium static text can return an empty
// AXRangeForPosition); keeping it scoped also stops value-bearing containers from
// shadowing the leaves in BFS order. Communication failures do not justify more calls
// into the same element.
static DictolTextMatch *lookup_text_node(AXUIElementRef element, NSString *role,
                                        NSString *value, CGPoint point,
                                        AXError *position_error, NSString **failure) {
    DictolTextMatch *match = word_at_point(element, value, point, position_error, failure);
    // fallback to token bounds when AXRangeForPosition is unavailable or returns an empty range
    if (!match && *position_error != kAXErrorCannotComplete && is_text_role(role)) {
        match = text_by_word_bounds(element, value, point);
    }
    match.role = role;
    match.value = value;
    return match;
}

// Build the public result only after a word and its geometry have been validated.
static NSDictionary *finish_text_match(DictolTextMatch *match, BOOL include_context) {
    NSDictionary *word = lookup_result(match.text, match.word, match.bounds);
    if (!include_context) return word;
    NSString *text = match.text;
    NSUInteger offset = match.offset;
    if (match.direct) {
        NSUInteger start = offset > 4096 ? offset - 4096 : 0;
        NSString *context = [match.value substringWithRange:NSMakeRange(start, MIN(match.value.length - start, 8192))];
        if (match.word.location >= start && NSMaxRange(match.word) <= start + context.length) {
            text = context;
            offset -= start;
        }
    }
    BOOL is_static = [match.role isEqualToString:@"AXStaticText"];
    NSMutableDictionary *result = [word mutableCopy];
    result[@"text"] = is_static ? normalize_static_text(text) : text;
    result[@"offset"] = @(offset);
    return is_static ? with_inline_context((__bridge AXUIElementRef)match.element,
                                           result, match.value) : result;
}

static const CFIndex max_children_per_node = 100;
static const int max_ancestor_depth = 2;

// The root has already been tried. Search matching children one level at a time
// before moving outward, without repeating root positioning or value queries.
static DictolTextMatch *text_in_descendants(AXUIElementRef element, CGPoint point,
                                           CFMutableSetRef visited,
                                           CFMutableSetRef nodes, NSString **stop_reason) {
    if (CFSetContainsValue(visited, element)) return nil;
    CFSetAddValue(visited, element);
    NSMutableArray *queue = [NSMutableArray arrayWithObject:(__bridge id)element];
    for (NSUInteger head = 0; head < queue.count; head++) {
        AXUIElementRef current = (__bridge AXUIElementRef)queue[head];

        CFTypeRef children_value = NULL;
        if (AXUIElementCopyAttributeValue(current, kAXChildrenAttribute, &children_value)
                != kAXErrorSuccess || !children_value) {
            if (children_value) CFRelease(children_value);
            continue;
        }
        if (CFGetTypeID(children_value) == CFArrayGetTypeID()) {
            CFArrayRef children = (CFArrayRef)children_value;
            CFIndex count = CFArrayGetCount(children);
            if (count > max_children_per_node) {
                // Skip this node's subtree rather than aborting the whole lookup;
                // a sibling branch may still contain the word under the cursor.
                CFRelease(children_value);
                continue;
            }
            for (CFIndex index = 0; index < count; index++) {
                CFTypeRef child = CFArrayGetValueAtIndex(children, index);
                if (!child || CFGetTypeID(child) != AXUIElementGetTypeID()) continue;
                if (CFSetContainsValue(visited, child)) {
                    continue;
                }
                CFSetAddValue(visited, child);
                NSString *role = string_attribute((AXUIElementRef)child, kAXRoleAttribute);
                if ([role isEqualToString:@"AXWebArea"]) {
                    continue;
                }
                NSString *value = string_attribute((AXUIElementRef)child, kAXValueAttribute);
                BOOL has_text = value.length > 0;
                CGRect bounds = element_bounds((AXUIElementRef)child);
                BOOL valid = !CGRectIsNull(bounds);
                BOOL contains = valid && CGRectContainsPoint(bounds, point);
                BOOL skip = has_text ? !contains : valid && bounds.size.height != 1 && !contains;
                if (!has_text) {
                    if (skip) continue;
                } else if (skip) {
                    continue;
                }
                if (!has_text) {
                    [queue addObject:(__bridge id)child];
                    continue;
                }
                if (!admit_lookup_node(nodes, (AXUIElementRef)child)) {
                    *stop_reason = @"node-limit:100";
                    CFRelease(children_value);
                    return nil;
                }
                AXError position_error = kAXErrorSuccess;
                NSString *failure = nil;
                DictolTextMatch *match = lookup_text_node((AXUIElementRef)child, role, value, point,
                                                         &position_error, &failure);
                if (match) {
                    CFRelease(children_value);
                    return match;
                }
                if (position_error != kAXErrorCannotComplete) [queue addObject:(__bridge id)child];
            }
        }
        CFRelease(children_value);
    }
    return nil;
}

// One attempt can request a fresh hit test before searching descendants.
static NSDictionary *read_accessible_text_once(double x, double y, BOOL include_context,
                                                int attempt_index, BOOL *retry, CFMutableSetRef nodes) {
    @autoreleasepool {
        DictolTextMatch *match = nil;
        NSString *failure = @"accessibility-not-authorized";
        if (AXIsProcessTrusted()) {
            AXUIElementRef system = AXUIElementCreateSystemWide();
            AXUIElementSetMessagingTimeout(system, 0.3f);
            AXUIElementRef element = NULL;
            AXError hit_error = AXUIElementCopyElementAtPosition(
                system, (float)x, (float)y, &element);
            const char *attempt_name = attempt_index == 0 ? "initial" :
                                       attempt_index == 1 ? "first-retry" : "second-retry";
            if (hit_error != kAXErrorSuccess || !element) {
                fprintf(stderr, "[Accessibility hit-test] attempt=%s point=(%.1f,%.1f) element=unavailable error=%d\n",
                        attempt_name, x, y, hit_error);
            }
            if (hit_error == kAXErrorSuccess && element) {
                CGPoint point = CGPointMake(x, y);
                NSMutableArray<NSString *> *attempts = [NSMutableArray array];
                CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
                // Search the hit element, then up to two ancestors and their unvisited descendants.
                for (int depth = 0; element && !match; depth++) {
                    AXUIElementSetMessagingTimeout(element, 0.3f);
                    NSString *role = string_attribute(element, kAXRoleAttribute) ?: @"unknown";
                    if (depth == 0) {
                        fprintf(stderr, "[Accessibility hit-test] attempt=%s point=(%.1f,%.1f) role=%s\n",
                                attempt_name, x, y, role.UTF8String);
                    }
                    if (depth == 0 && attempt_index < 2) {
                        // Chromium may return AXWebArea when accessibility tree is being rebuilt.
                        if ([role isEqualToString:@"AXWebArea"] ||
                            [role isEqualToString:@"AXScrollArea"]) {
                            *retry = YES;
                            break;
                        }
                        // Chromium may return an outdated node that is not the one containing the word under the pointer.
                        CGRect bounds = element_bounds(element);
                        if (CGRectIsNull(bounds) || !CGRectContainsPoint(bounds, point)) {
                            *retry = YES;
                            break;
                        }
                    }
                    // fallback to OCR
                    if ([role isEqualToString:@"AXImage"]) {
                        [attempts addObject:@"AXImage: image-content"];
                        break;
                    }
                    // Stop before searching broad containers and their subtrees.
                    if ([role isEqualToString:@"AXWebArea"] ||
                        [role isEqualToString:@"AXWindow"] ||
                        [role isEqualToString:@"AXScrollArea"] ||
                        [role isEqualToString:@"AXApplication"]) {
                        [attempts addObject:[NSString stringWithFormat:@"%@: search-boundary", role]];
                        break;
                    }
                    NSString *attempt_failure = @"already-searched";
                    if (!CFSetContainsValue(visited, element)) {
                        NSString *value = string_attribute(element, kAXValueAttribute);
                        BOOL has_text = value.length > 0;
                        AXError position_error = kAXErrorSuccess;
                        attempt_failure = @"no-node-text";
                        if (has_text) {
                            if (!admit_lookup_node(nodes, element)) {
                                [attempts addObject:@"node-limit:100"];
                                break;
                            }
                            match = lookup_text_node(element, role, value, point, &position_error, &attempt_failure);
                        }
                        if (match) break;
                        // A communication failure does not justify more calls into this subtree.
                        if (position_error != kAXErrorCannotComplete) {
                            NSString *stop_reason = nil;
                            match = text_in_descendants(element, point, visited, nodes, &stop_reason);
                            if (match) break;
                            if (stop_reason) {
                                [attempts addObject:stop_reason];
                                break;
                            }
                            attempt_failure = [attempt_failure stringByAppendingString:@"; descendant-word-bounds-miss"];
                        } else {
                            CFSetAddValue(visited, element);
                        }
                    }
                    [attempts addObject:[NSString stringWithFormat:@"%@: %@", role,
                                         attempt_failure ?: @"unknown"]];
                    if ([role isEqualToString:@"AXTextArea"]) break;
                    if (depth == max_ancestor_depth) {
                        [attempts addObject:@"ancestor-depth-limit"];
                        break;
                    }
                    CFTypeRef parent = NULL;
                    AXError error = AXUIElementCopyAttributeValue(element, kAXParentAttribute, &parent);
                    CFRelease(element);
                    element = NULL;
                    if (error == kAXErrorSuccess && parent &&
                        CFGetTypeID(parent) == AXUIElementGetTypeID()) {
                        element = (AXUIElementRef)parent;
                    } else if (parent) {
                        CFRelease(parent);
                    }
                }
                CFRelease(visited);
                if (!match) failure = [attempts componentsJoinedByString:@"; "];
                if (element) CFRelease(element);
            } else if (element) {
                CFRelease(element);
            }
            if (!match && hit_error != kAXErrorSuccess) {
                failure = [NSString stringWithFormat:@"hit-test:%d", hit_error];
            }
            CFRelease(system);
        }
        // A retry is an internal state, not a result to serialize and discard.
        if (*retry) return nil;
        NSDictionary *result = match ? finish_text_match(match, include_context) : nil;
        return @{@"result": result ?: NSNull.null,
                 @"failure": result ? NSNull.null : failure};
    }
}

// Keep the retry delay on the N-API worker, including for our own windows.
int dictol_read_mac_accessible_text(double x, double y, int include_context,
                                    uint8_t **output, size_t *output_length) {
    @autoreleasepool {
        if (!output || !output_length) return 0;
        *output = NULL;
        *output_length = 0;
        BOOL own_window = !pthread_main_np() && point_is_inside_own_window(x, y);
        CFMutableSetRef nodes = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
        __block BOOL retry = NO;
        __block NSDictionary *lookup = nil;
        void (^attempt)(int) = ^(int attempt_index) {
            if (own_window) {
                // Electron's accessibility callbacks must run on the AppKit main thread.
                dispatch_sync(dispatch_get_main_queue(), ^{
                    lookup = read_accessible_text_once(x, y, include_context, attempt_index, &retry, nodes);
                });
            } else {
                lookup = read_accessible_text_once(x, y, include_context, attempt_index, &retry, nodes);
            }
        };
        for (int index = 0; index < 3; index++) {
            retry = NO;
            attempt(index);
            if (!retry) break;
            usleep(20000);
        }
        CFRelease(nodes);
        return copy_json(lookup, output, output_length);
    }
}

// Marker attributes are supplied by Chromium/WebKit. Keep opaque markers intact;
// their offsets are not interchangeable with AXSelectedTextRange on the document.
static id selection_parameter(AXUIElementRef element, CFStringRef attribute,
                              CFTypeRef parameter, CFTypeID type) {
    CFTypeRef value = NULL;
    AXError error = AXUIElementCopyParameterizedAttributeValue(element, attribute, parameter, &value);
    if (error == kAXErrorSuccess && value && CFGetTypeID(value) == type) {
        return CFBridgingRelease(value);
    }
    if (value) CFRelease(value);
    return nil;
}

// Resolve the selection's first text position to its owning node. Sorting the
// endpoints also handles selections dragged backwards. No hit test/tree scan.
static id selection_text_node(AXUIElementRef focused, NSString *selected,
                              CFIndex *offset) {
    CFTypeRef value = NULL;
    AXError error = AXUIElementCopyAttributeValue(focused, CFSTR("AXSelectedTextMarkerRange"), &value);
    id selected_range = CFBridgingRelease(value);
    if (error != kAXErrorSuccess || !selected_range ||
        CFGetTypeID((__bridge CFTypeRef)selected_range) != AXTextMarkerRangeGetTypeID()) {
        return nil;
    }
    id anchor = CFBridgingRelease(AXTextMarkerRangeCopyStartMarker((__bridge AXTextMarkerRangeRef)selected_range));
    id focus = CFBridgingRelease(AXTextMarkerRangeCopyEndMarker((__bridge AXTextMarkerRangeRef)selected_range));
    if (!anchor || !focus) return nil;
    id ordered = selection_parameter(focused, CFSTR("AXTextMarkerRangeForUnorderedTextMarkers"),
        (__bridge CFArrayRef)@[anchor, focus], AXTextMarkerRangeGetTypeID());
    if (!ordered) return nil;
    NSString *marker_text = selection_parameter(focused, CFSTR("AXStringForTextMarkerRange"),
        (__bridge CFTypeRef)ordered, CFStringGetTypeID());
    if (![marker_text isEqualToString:selected]) return nil;
    id start = CFBridgingRelease(AXTextMarkerRangeCopyStartMarker((__bridge AXTextMarkerRangeRef)ordered));
    if (!start) return nil;
    id node = selection_parameter(focused, CFSTR("AXUIElementForTextMarker"),
        (__bridge CFTypeRef)start, AXUIElementGetTypeID());
    if (!node) return nil;
    // Measure from this node's start, rather than treating a document index as a
    // node-local offset. This also avoids searching for repeated selected words.
    id node_range = selection_parameter((__bridge AXUIElementRef)node, CFSTR("AXTextMarkerRangeForUIElement"),
        (__bridge CFTypeRef)node, AXTextMarkerRangeGetTypeID());
    if (!node_range) return nil;
    id node_start = CFBridgingRelease(AXTextMarkerRangeCopyStartMarker((__bridge AXTextMarkerRangeRef)node_range));
    if (!node_start) return nil;
    id prefix = CFBridgingRelease(AXTextMarkerRangeCreate(NULL,
        (__bridge AXTextMarkerRef)node_start, (__bridge AXTextMarkerRef)start));
    if (!prefix) return nil;
    NSNumber *length = selection_parameter(focused, CFSTR("AXLengthForTextMarkerRange"),
        (__bridge CFTypeRef)prefix, CFNumberGetTypeID());
    if (!length || length.longLongValue < 0) return nil;
    *offset = length.longLongValue;
    return node;
}

// The focused element supplies selection state; the selected text's node supplies
// context, using the same inline expansion as an AI hover lookup.
int dictol_read_mac_accessible_selection(int include_context, uint8_t **output,
                                         size_t *output_length) {
    @autoreleasepool {
        if (!output || !output_length) return 0;
        *output = NULL;
        *output_length = 0;
        NSString *failure = @"accessibility-not-authorized";
        NSDictionary *result = nil;
        if (AXIsProcessTrusted()) {
            AXUIElementRef system = AXUIElementCreateSystemWide();
            AXUIElementSetMessagingTimeout(system, 0.3f);
            CFTypeRef focused = NULL;
            AXError error = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute, &focused);
            if (error == kAXErrorSuccess && focused && CFGetTypeID(focused) == AXUIElementGetTypeID()) {
                AXUIElementRef element = (AXUIElementRef)focused;
                pid_t pid = 0;
                if (!pthread_main_np() && AXUIElementGetPid(element, &pid) == kAXErrorSuccess &&
                    pid == getpid()) {
                    CFRelease(focused);
                    CFRelease(system);
                    __block int bridge_result = 0;
                    dispatch_sync(dispatch_get_main_queue(), ^{
                        bridge_result = dictol_read_mac_accessible_selection(include_context, output, output_length);
                    });
                    return bridge_result;
                }
                AXUIElementSetMessagingTimeout(element, 0.3f);
                NSString *selected = string_attribute(element, kAXSelectedTextAttribute);
                if (selected.length == 0) {
                    failure = @"selected-text-unavailable";
                } else {
                    NSMutableDictionary *selection = [@{ @"selectedText": selected } mutableCopy];
                    result = selection;
                    // Keep the resolved CF element alive while element is borrowed below.
                    __attribute__((objc_precise_lifetime)) id resolved_node = nil;
                    if (include_context) {
                        CFIndex node_offset = 0;
                        resolved_node = selection_text_node(element, selected, &node_offset);
                        BOOL valid = resolved_node != nil;
                        if (resolved_node) {
                            element = (__bridge AXUIElementRef)resolved_node;
                        } else {
                            // Native text controls may expose only a local CFRange.
                            CFTypeRef range_value = NULL;
                            CFRange range = CFRangeMake(0, 0);
                            error = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute, &range_value);
                            valid = error == kAXErrorSuccess && range_value &&
                                CFGetTypeID(range_value) == AXValueGetTypeID() &&
                                AXValueGetType(range_value) == kAXValueCFRangeType &&
                                AXValueGetValue(range_value, kAXValueCFRangeType, &range) &&
                                range.location >= 0 && range.length > 0;
                            if (range_value) CFRelease(range_value);
                            node_offset = range.location;
                        }
                        if (valid) {
                            CFIndex start = 0;
                            NSString *node_value = string_attribute(element, kAXValueAttribute);
                            NSString *text = text_near_position(element, node_value, node_offset,
                                                                4096, 8192, &start);
                            if (text && node_offset >= start && node_offset - start < text.length) {
                                BOOL is_static = [string_attribute(element, kAXRoleAttribute) isEqualToString:@"AXStaticText"];
                                selection[@"text"] = is_static ? normalize_static_text(text) : text;
                                selection[@"offset"] = @(node_offset - start);
                                result = is_static ? with_inline_context(element, selection, node_value) : selection;
                                // Validate after expansion, including selections across inline nodes.
                                NSString *context = result[@"text"];
                                NSUInteger offset = [result[@"offset"] unsignedIntegerValue];
                                NSString *expected = is_static ? normalize_static_text(selected) : selected;
                                if (offset > context.length || expected.length > context.length - offset ||
                                    ![[context substringWithRange:NSMakeRange(offset, expected.length)] isEqualToString:expected]) {
                                    result = @{@"selectedText": selected};
                                }
                            }
                        }
                    }
                }
            } else {
                failure = [NSString stringWithFormat:@"focused-element:%d", error];
            }
            if (focused) CFRelease(focused);
            CFRelease(system);
        }
        NSDictionary *lookup = @{ @"result": result ?: NSNull.null,
                                  @"failure": result ? NSNull.null : failure };
        return copy_json(lookup, output, output_length);
    }
}

void dictol_free_mac_accessible_text(uint8_t *bytes) {
    free(bytes);
}
