#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <NaturalLanguage/NaturalLanguage.h>
#include <dispatch/dispatch.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// 判断屏幕坐标是否位于当前进程的任一窗口内。
// An AX hit test against our own window calls Electron's accessibilityHitTest
// in this process. That callback must run on the AppKit main thread.
static BOOL point_is_inside_own_window(double x, double y) {
    CFArrayRef windows = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID);
    if (!windows) return YES;
    BOOL inside = NO;
    CGPoint point = CGPointMake(x, y);
    for (CFIndex index = 0; index < CFArrayGetCount(windows); index++) {
        CFDictionaryRef window = (CFDictionaryRef)CFArrayGetValueAtIndex(windows, index);
        CFDictionaryRef bounds_value = (CFDictionaryRef)CFDictionaryGetValue(window, kCGWindowBounds);
        CFNumberRef owner = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowOwnerPID);
        int pid = 0;
        CGRect bounds = CGRectZero;
        if (owner && CFNumberGetValue(owner, kCFNumberIntType, &pid) && pid == getpid() &&
            bounds_value && CGRectMakeWithDictionaryRepresentation(bounds_value, &bounds) &&
            CGRectContainsPoint(bounds, point)) {
            inside = YES;
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

static BOOL is_ascii_compound_character(unichar character) {
    return (character >= 'A' && character <= 'Z') ||
           (character >= 'a' && character <= 'z') ||
           (character >= '0' && character <= '9') ||
           character == '_' || character == '-' || character == '\'' || character == 0x2019;
}

// Expand ASCII compound words and trim edge separators.
static NSRange expanded_word_range(NSString *text, NSRange range) {
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

// 返回字符所属的单词范围。
static NSRange word_range(NSString *text, NSUInteger offset) {
    NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitWord];
    tokenizer.string = text;
    NSRange range = [tokenizer tokenRangeAtIndex:offset];
    if (range.location == NSNotFound || range.length == 0 || NSMaxRange(range) > text.length ||
        offset < range.location || offset >= NSMaxRange(range)) return NSMakeRange(NSNotFound, 0);
    return expanded_word_range(text, range);
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

static BOOL bounds_for_character(AXUIElementRef element, NSRange character, CGRect *bounds) {
    return bounds_for_range(element,
                            CFRangeMake(character.location, character.length),
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
                                 CGPoint point, CGRect *bounds) {
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
    if (!bounds_for_character(element, first, &first_bounds) ||
        !bounds_for_character(element, last, &last_bounds)) return YES;
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
            valid = bounds_for_character(element, character, &character_bounds);
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

static NSString *const no_word_at_point = @"no-word-at-point";

// 将文本拆成以词为单位的token，逐词扫描，找到包含指针的词并返回其屏幕矩形
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
        // 获取词的屏幕矩形，若失败则跳过该词
        if (!bounds_for_range(element, token_range, &token_bounds, NULL)) return;
        // 检查指针是否在词的外接矩形内，若不在则跳过该词
        if (!CGRectContainsPoint(CGRectInset(token_bounds, -3, -3), point)) return;

        // 扩展到包含 ASCII 复合字符的完整词
        NSRange word = expanded_word_range(text, token);
        if (word.location == NSNotFound) return;

        CFRange global_word = CFRangeMake(word.location, word.length);
        CGRect bounds = token_bounds;
        if (!NSEqualRanges(token, word) &&
            !bounds_for_range(element, global_word, &bounds, NULL)) return;
        if (!word_bounds_at_point(element, text, word, point, &bounds)) return;
        hit = matched_word(element, text, token.location, word, bounds);
        *stop = YES;
    }];
    return hit;
}

// 使用 AXRangeForPosition 快速定位指针下的字符索引，再解析出该字符所属的单词，并验证其屏幕矩形。
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
    // 指定位置的字符索引（UTF-16）。并非所有元素都支持这个查询
    AXError error = AXUIElementCopyParameterizedAttributeValue(
        element, kAXRangeForPositionParameterizedAttribute, position, &range_value);
    *position_error = error;
    CFRelease(position);
    if (error != kAXErrorSuccess || !range_value) {
        if (range_value) CFRelease(range_value);
        *failure = [NSString stringWithFormat:@"range-for-position:%d", error];
        return nil;
    }
    // glyph 是光标下的字符，还不是单词
    CFRange glyph = CFRangeMake(0, 0);
    BOOL valid_range = CFGetTypeID(range_value) == AXValueGetTypeID() &&
                       AXValueGetType(range_value) == kAXValueCFRangeType &&
                       AXValueGetValue(range_value, kAXValueCFRangeType, &glyph);
    CFRelease(range_value);
    if (!valid_range || glyph.location < 0 || glyph.length <= 0 || glyph.location >= value.length) {
        *failure = @"invalid-character-range";
        return nil;
    }

    // fast fail: 如果光标在空格字符上，返回特定的错误码，避免后续的ocr
    if (glyph.length == 1 &&
        [[NSCharacterSet whitespaceCharacterSet] characterIsMember:[value characterAtIndex:glyph.location]]) {
        CGRect bounds = CGRectZero;
        if (bounds_for_range(element, glyph, &bounds, NULL) && CGRectContainsPoint(bounds, point)) {
            *failure = no_word_at_point;
            return nil;
        }
    }

    // get the word range that contains the character at glyph.location
    NSRange word = word_range(value, (NSUInteger)glyph.location);
    if (word.location == NSNotFound) {
        *failure = @"word-unavailable";
        return nil;
    }

    CFRange global_word = CFRangeMake(word.location, word.length);
    CGRect bounds = CGRectZero;
    // 获取词的屏幕矩形
    if (!bounds_for_range(element, global_word, &bounds, failure)) return nil;
    // 处理跨行词：逐字符取框，收敛到指针所在的那一行
    if (!word_bounds_at_point(element, value, word, point, &bounds)) {
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

// Limit distinct nodes examined while searching descendant subtrees.
static const CFIndex max_lookup_nodes = 500;

static BOOL admit_lookup_node(CFMutableSetRef nodes, AXUIElementRef element) {
    if (!nodes || CFSetContainsValue(nodes, element)) return YES;
    if (CFSetGetCount(nodes) >= max_lookup_nodes) return NO;
    CFSetAddValue(nodes, element);
    return YES;
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

// Some applications build their full AX tree only after an assistive client
// requests it. A persistent container hit can activate the tree for later lookups.
static void request_application_accessibility(AXUIElementRef element) {
    pid_t pid = 0;
    if (AXUIElementGetPid(element, &pid) != kAXErrorSuccess || pid <= 0) return;
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    if (!application) return;
    AXUIElementSetMessagingTimeout(application, 0.3f);
    // Chrome/Chromium: set "AXEnhancedUserInterface" to true to enable AXAPI
    AXUIElementSetAttributeValue(application, CFSTR("AXEnhancedUserInterface"), kCFBooleanTrue);
    // Electron Apps: set "AXManualAccessibility" to true to enable AXAPI
    AXUIElementSetAttributeValue(application, CFSTR("AXManualAccessibility"), kCFBooleanTrue);
    CFRelease(application);
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

// 在element里查找光标下的词，返回其文本、偏移、屏幕矩形和角色。
static DictolTextMatch *lookup_text_node(AXUIElementRef element, NSString *role,
                                        NSString *value, CGPoint point,
                                        AXError *position_error, NSString **failure) {
    // 先用AXRangeForPosition快速定位字符索引
    DictolTextMatch *match = word_at_point(element, value, point, position_error, failure);
    // fallback to token bounds when AXRangeForPosition is unavailable or returns an empty range
    if (!match && ![*failure isEqualToString:no_word_at_point] &&
        *position_error != kAXErrorCannotComplete && is_text_role(role)) {
        match = text_by_word_bounds(element, value, point);
    }
    match.role = role;
    return match;
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
                if (!admit_lookup_node(nodes, (AXUIElementRef)child)) {
                    *stop_reason = @"node-limit:500";
                    CFRelease(children_value);
                    return nil;
                }
                CFSetAddValue(visited, child);
                NSString *role = string_attribute((AXUIElementRef)child, kAXRoleAttribute);
                if ([role isEqualToString:@"AXWebArea"] || [role isEqualToString:@"AXImage"]) {
                    continue;
                }
                CGRect bounds = element_bounds((AXUIElementRef)child);
                BOOL valid = !CGRectIsNull(bounds);
                BOOL contains = valid && CGRectContainsPoint(bounds, point);
                if (valid && bounds.size.height != 1 && !contains) continue;

                NSString *value = string_attribute((AXUIElementRef)child, kAXValueAttribute);
                BOOL has_text = value.length > 0;
                if (has_text && !contains) continue;
                if (!has_text) {
                    [queue addObject:(__bridge id)child];
                    continue;
                }
                AXError position_error = kAXErrorSuccess;
                NSString *failure = nil;
                DictolTextMatch *match = lookup_text_node((AXUIElementRef)child, role, value, point,
                                                         &position_error, &failure);
                if (match) {
                    CFRelease(children_value);
                    return match;
                }
                if ([failure isEqualToString:no_word_at_point]) {
                    *stop_reason = no_word_at_point;
                    CFRelease(children_value);
                    return nil;
                }
                if (position_error != kAXErrorCannotComplete) [queue addObject:(__bridge id)child];
            }
        }
        CFRelease(children_value);
    }
    return nil;
}

// Flatten inline text in order, keeping unsupported nodes as boundaries.
static BOOL append_inline_text(AXUIElementRef element, AXUIElementRef target, NSString *target_text,
                               NSMutableArray *parts, NSUInteger depth, NSUInteger *visited,
                               NSUInteger *target_index) {
    if (++*visited > 64) {
        [parts addObject:[NSNull null]];
        return NO;
    }
    NSString *role = string_attribute(element, kAXRoleAttribute);
    if ([role isEqualToString:@"AXStaticText"]) {
        NSString *value = CFEqual(element, target) ? target_text : string_attribute(element, kAXValueAttribute);
        if (!value) {
            [parts addObject:[NSNull null]];
            return YES;
        }
        if (CFEqual(element, target)) *target_index = parts.count;
        [parts addObject:normalize_static_text(value)];
        return YES;
    }
    if ([role isEqualToString:@"AXLineBreak"]) {
        [parts addObject:@"\n"];
        return YES;
    }
    BOOL container = [role isEqualToString:@"AXLink"] ||
        ([role isEqualToString:@"AXGroup"] &&
         (depth == 0 || [string_attribute(element, kAXSubroleAttribute) hasSuffix:@"StyleGroup"]));
    if (!container) {
        [parts addObject:[NSNull null]];
        return YES;
    }

    CFTypeRef children_value = NULL;
    AXError error = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &children_value);
    if (error != kAXErrorSuccess || !children_value || CFGetTypeID(children_value) != CFArrayGetTypeID()) {
        if (children_value) CFRelease(children_value);
        [parts addObject:[NSNull null]];
        return YES;
    }
    CFArrayRef children = (CFArrayRef)children_value;
    CFIndex count = CFArrayGetCount(children);
    if (!count) [parts addObject:[NSNull null]];
    BOOL complete = YES;
    for (CFIndex index = 0; complete && index < count; index++) {
        CFTypeRef child = CFArrayGetValueAtIndex(children, index);
        if (!child || CFGetTypeID(child) != AXUIElementGetTypeID()) {
            [parts addObject:[NSNull null]];
        } else {
            complete = append_inline_text((AXUIElementRef)child, target, target_text, parts,
                                          depth + 1, visited, target_index);
        }
    }
    CFRelease(children);
    return complete;
}

// Expand style groups up to the nearest enclosing container, then retain the
// contiguous text around the hit without crossing unsupported nodes.
static NSDictionary *with_inline_context(AXUIElementRef target, NSDictionary *result, NSString *value) {
    NSString *target_text = normalize_static_text(value);
    if (!target_text || ![target_text isEqualToString:result[@"text"]]) return result;
    NSUInteger target_offset = [result[@"offset"] unsignedIntegerValue];
    if (target_offset >= target_text.length) return result;

    AXUIElementRef root = target;
    CFRetain(root);
    for (int depth = 0; depth < 3; depth++) {
        CFTypeRef parent = NULL;
        AXError error = AXUIElementCopyAttributeValue(root, kAXParentAttribute, &parent);
        if (error != kAXErrorSuccess || !parent || CFGetTypeID(parent) != AXUIElementGetTypeID()) {
            if (parent) CFRelease(parent);
            break;
        }
        CFRelease(root);
        root = (AXUIElementRef)parent;
        NSString *subrole = string_attribute(root, kAXSubroleAttribute);
        if (![subrole hasSuffix:@"StyleGroup"]) break;
    }
    if (CFEqual(root, target)) {
        CFRelease(root);
        return result;
    }
    NSMutableArray *parts = [NSMutableArray array];
    NSUInteger visited = 0, target_index = NSNotFound;
    append_inline_text(root, target, target_text, parts, 0, &visited, &target_index);
    CFRelease(root);
    if (target_index == NSNotFound || target_text.length > 8192) return result;

    NSUInteger start = target_index, end = target_index + 1, length = target_text.length;
    while (start > 0 && [parts[start - 1] isKindOfClass:[NSString class]]) {
        NSString *part = parts[start - 1];
        if (part.length > 8192 - length) break;
        length += part.length;
        start--;
    }
    while (end < parts.count && [parts[end] isKindOfClass:[NSString class]]) {
        NSString *part = parts[end];
        if (part.length > 8192 - length) break;
        length += part.length;
        end++;
    }
    NSMutableString *text = [NSMutableString string];
    NSUInteger offset = target_offset;
    for (NSUInteger index = start; index < end; index++) {
        NSString *part = parts[index];
        if (index < target_index) offset += part.length;
        [text appendString:part];
    }
    NSMutableDictionary *combined = [result mutableCopy];
    combined[@"text"] = text;
    combined[@"offset"] = @(offset);
    return combined;
}

// Build the public result only after a word and its geometry have been validated.
static NSDictionary *finish_text_match(DictolTextMatch *match, BOOL include_context) {
    NSDictionary *word = lookup_result(match.text, match.word, match.bounds);
    if (!include_context) return word;

    NSString *text = match.text;
    NSUInteger offset = match.offset;
    if (match.direct) {
        NSUInteger start = offset > 4096 ? offset - 4096 : 0;
        NSString *context = [match.text substringWithRange:NSMakeRange(start, MIN(match.text.length - start, 8192))];
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
                                           result, match.text) : result;
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
            // 获取光标下的元素，可能是文本节点，也可能是容器节点
            AXError hit_error = AXUIElementCopyElementAtPosition(system, (float)x, (float)y, &element);
            if (hit_error == kAXErrorSuccess && element) {
                CGPoint point = CGPointMake(x, y);
                NSMutableArray<NSString *> *attempts = [NSMutableArray array];
                BOOL no_word = NO;
                CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);

                // Search the hit element, then up to two ancestors and their unvisited descendants.
                for (int depth = 0; element && !match; depth++) {
                    AXUIElementSetMessagingTimeout(element, 0.3f);
                    NSString *role = string_attribute(element, kAXRoleAttribute) ?: @"unknown";
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
                        if (depth == 0 && attempt_index == 2 &&
                            ([role isEqualToString:@"AXWebArea"] ||
                             [role isEqualToString:@"AXScrollArea"])) {
                            request_application_accessibility(element);
                        }
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
                            match = lookup_text_node(element, role, value, point, &position_error, &attempt_failure);
                        }
                        if (match) break;
                        if ([attempt_failure isEqualToString:no_word_at_point]) {
                            no_word = YES;
                            break;
                        }
                        // A communication failure does not justify more calls into this subtree.
                        if (position_error != kAXErrorCannotComplete) {
                            NSString *stop_reason = nil;
                            match = text_in_descendants(element, point, visited, nodes, &stop_reason);
                            if (match) break;
                            if (stop_reason) {
                                if ([stop_reason isEqualToString:no_word_at_point]) no_word = YES;
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
                if (!match) failure = no_word ? no_word_at_point : [attempts componentsJoinedByString:@"; "];
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

// 入口方法
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

void dictol_free_mac_accessible_text(uint8_t *bytes) {
    free(bytes);
}
