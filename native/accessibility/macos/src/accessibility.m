#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <NaturalLanguage/NaturalLanguage.h>
#include <dispatch/dispatch.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// 判断某个屏幕坐标是否落在当前进程自己的窗口内
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
        CFNumberRef owner = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowOwnerPID);
        int pid = 0;
        if (!owner || !CFNumberGetValue(owner, kCFNumberIntType, &pid) || pid != getpid()) continue;
        CFDictionaryRef bounds_value = (CFDictionaryRef)CFDictionaryGetValue(window, kCGWindowBounds);
        CGRect bounds = CGRectZero;
        if (bounds_value && CGRectMakeWithDictionaryRepresentation(bounds_value, &bounds) &&
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

// AX and NSString ranges use UTF-16 offsets. Keep a window around the hit and
// report its start so callers can translate back to the element's coordinates.
static NSString *text_near_position(AXUIElementRef element, CFIndex position,
                                    CFIndex *window_start) {
    CFTypeRef count_value = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXNumberOfCharactersAttribute, &count_value)
            == kAXErrorSuccess && count_value) {
        CFIndex count = 0;
        if (CFGetTypeID(count_value) == CFNumberGetTypeID()) {
            CFNumberGetValue(count_value, kCFNumberCFIndexType, &count);
        }
        CFRelease(count_value);
        if (count > position) {
            CFIndex start = MAX(0, position - 4096);
            CFRange range = CFRangeMake(start, MIN(count - start, 8192));
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

    // Some elements expose a value but do not support string-for-range.
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXValueAttribute, &value) != kAXErrorSuccess ||
        !value) {
        if (value) CFRelease(value);
        return nil;
    }
    if (CFGetTypeID(value) != CFStringGetTypeID()) {
        CFRelease(value);
        return nil;
    }
    NSString *text = (__bridge_transfer NSString *)value;
    if (position >= text.length) return nil;
    CFIndex start = MAX(0, position - 4096);
    *window_start = start;
    return [text substringWithRange:NSMakeRange(start, MIN(text.length - start, 8192))];
}

static BOOL is_ascii_compound_character(unichar character) {
    return (character >= 'A' && character <= 'Z') ||
           (character >= 'a' && character <= 'z') ||
           (character >= '0' && character <= '9') ||
           character == '_' || character == '-' || character == '\'' || character == 0x2019;
}

// Extend the token across common ASCII compound-word characters, then trim
// separators from its edges so the returned range contains the lookup word.
static NSRange word_range(NSString *text, NSUInteger offset) {
    NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitWord];
    tokenizer.string = text;
    NSRange range = [tokenizer tokenRangeAtIndex:offset];
    if (range.location == NSNotFound || range.length == 0 || NSMaxRange(range) > text.length ||
        offset < range.location || offset >= NSMaxRange(range)) return NSMakeRange(NSNotFound, 0);

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

static BOOL bounds_for_range(AXUIElementRef element, CFRange range, CGRect *bounds) {
    AXValueRef parameter = AXValueCreate(kAXValueCFRangeType, &range);
    if (!parameter) return NO;
    CFTypeRef value = NULL;
    AXError error = AXUIElementCopyParameterizedAttributeValue(
        element, kAXBoundsForRangeParameterizedAttribute, parameter, &value);
    CFRelease(parameter);
    if (error != kAXErrorSuccess || !value) {
        if (value) CFRelease(value);
        return NO;
    }
    BOOL valid = CFGetTypeID(value) == AXValueGetTypeID() &&
                 AXValueGetType(value) == kAXValueCGRectType &&
                 AXValueGetValue(value, kAXValueCGRectType, bounds) &&
                 bounds->size.width > 0 && bounds->size.height > 0;
    CFRelease(value);
    return valid;
}

static BOOL bounds_for_character(AXUIElementRef element, NSRange character,
                                 CFIndex window_start, CGRect *bounds) {
    return bounds_for_range(element,
                            CFRangeMake(window_start + character.location, character.length),
                            bounds);
}

// A word spanning lines has one enclosing rectangle that includes unrelated
// text. Verify the point against character rectangles and return the hit line.
static BOOL word_bounds_at_point(AXUIElementRef element, NSString *text, NSRange word,
                                 CFIndex window_start, CGPoint point, CGRect *bounds) {
    if (!CGRectContainsPoint(CGRectInset(*bounds, -6, -6), point)) return NO;

    NSRange first = [text rangeOfComposedCharacterSequenceAtIndex:word.location];
    NSRange last = [text rangeOfComposedCharacterSequenceAtIndex:NSMaxRange(word) - 1];
    if (NSEqualRanges(first, last)) return YES;

    CGRect first_bounds = CGRectZero, last_bounds = CGRectZero;
    if (!bounds_for_character(element, first, window_start, &first_bounds) ||
        !bounds_for_character(element, last, window_start, &last_bounds)) return YES;
    if (CGRectGetMinY(first_bounds) < CGRectGetMaxY(last_bounds) &&
        CGRectGetMinY(last_bounds) < CGRectGetMaxY(first_bounds)) return YES;

    NSMutableArray<NSValue *> *rectangles = [NSMutableArray array];
    CGRect hit = CGRectNull;
    for (NSUInteger index = word.location; index < NSMaxRange(word);) {
        NSRange character = [text rangeOfComposedCharacterSequenceAtIndex:index];
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
            if (CGRectIsNull(hit) &&
                CGRectContainsPoint(CGRectInset(character_bounds, -6, -6), point)) {
                hit = character_bounds;
            }
        }
        index = NSMaxRange(character);
    }
    if (CGRectIsNull(hit)) return NO;

    CGRect line_bounds = CGRectNull;
    for (NSValue *value in rectangles) {
        CGRect rectangle = value.rectValue;
        if (CGRectGetMinY(rectangle) < CGRectGetMaxY(hit) &&
            CGRectGetMinY(hit) < CGRectGetMaxY(rectangle)) {
            line_bounds = CGRectUnion(line_bounds, rectangle);
        }
    }
    *bounds = line_bounds;
    return YES;
}

// Normal lookups need only the word and bounds; AI lookups also need the
// surrounding text and the UTF-16 offset used for sentence extraction.
static NSDictionary *lookup_result(NSString *text, NSUInteger offset, NSRange word,
                                   CGRect bounds, BOOL include_context) {
    NSMutableDictionary *result = [@{
        @"word": [text substringWithRange:word],
        @"x": @(bounds.origin.x),
        @"y": @(bounds.origin.y),
        @"width": @(bounds.size.width),
        @"height": @(bounds.size.height)
    } mutableCopy];
    if (include_context) {
        result[@"text"] = text;
        result[@"offset"] = @(offset);
    }
    return result;
}

// Preserve UTF-16 offsets while treating line breaks inside a text node as spaces.
static NSString *normalize_static_text(NSString *text) {
    return [text stringByReplacingOccurrencesOfString:@"\n" withString:@" "];
}

// Chromium may return an empty AXRangeForPosition for static text. Scan token
// rectangles, then validate the expanded word; offset remains the token start.
static NSDictionary *text_by_word_bounds(AXUIElementRef element, CGPoint point,
                                         BOOL include_context) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXValueAttribute, &value) != kAXErrorSuccess ||
        !value) {
        if (value) CFRelease(value);
        return nil;
    }
    if (CFGetTypeID(value) != CFStringGetTypeID()) {
        CFRelease(value);
        return nil;
    }
    NSString *text = (__bridge_transfer NSString *)value;
    if (text.length == 0 || text.length > 8192) return nil;

    NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitWord];
    tokenizer.string = text;
    __block NSDictionary *hit = nil;
    [tokenizer enumerateTokensInRange:NSMakeRange(0, text.length)
                          usingBlock:^(NSRange token, NLTokenizerAttributes flags, BOOL *stop) {
        if (token.length == 0 || NSMaxRange(token) > text.length) return;
        CFRange token_range = CFRangeMake(token.location, token.length);
        CGRect token_bounds = CGRectZero;
        if (!bounds_for_range(element, token_range, &token_bounds)) return;
        if (!CGRectContainsPoint(CGRectInset(token_bounds, -3, -3), point)) return;

        NSRange word = word_range(text, token.location);
        if (word.location == NSNotFound) return;
        CFRange global_word = CFRangeMake(word.location, word.length);
        CGRect bounds = CGRectZero;
        if (!bounds_for_range(element, global_word, &bounds) ||
            !word_bounds_at_point(element, text, word, 0, point, &bounds)) return;
        hit = lookup_result(text,
                            token.location, word, bounds, include_context);
        *stop = YES;
    }];
    return hit;
}

// Resolve the character at the point to a word and verify its screen rectangle.
static NSDictionary *text_at_point(AXUIElementRef element, CGPoint point, BOOL include_context,
                                   AXError *position_error, NSString **failure) {
    AXValueRef position = AXValueCreate(kAXValueCGPointType, &point);
    if (!position) {
        *failure = @"position-value";
        return nil;
    }
    CFTypeRef range_value = NULL;
    AXError error = AXUIElementCopyParameterizedAttributeValue(
        element, kAXRangeForPositionParameterizedAttribute, position, &range_value);
    *position_error = error;
    CFRelease(position);
    if (error != kAXErrorSuccess || !range_value) {
        if (range_value) CFRelease(range_value);
        *failure = [NSString stringWithFormat:@"range-for-position:%d", error];
        return nil;
    }
    CFRange glyph = CFRangeMake(0, 0);
    BOOL valid_range = CFGetTypeID(range_value) == AXValueGetTypeID() &&
                       AXValueGetType(range_value) == kAXValueCFRangeType &&
                       AXValueGetValue(range_value, kAXValueCFRangeType, &glyph);
    CFRelease(range_value);
    if (!valid_range || glyph.location < 0 || glyph.length <= 0) {
        *failure = @"invalid-character-range";
        return nil;
    }

    CFIndex window_start = 0;
    NSString *text = text_near_position(element, glyph.location, &window_start);
    if (!text || glyph.location < window_start || glyph.location >= window_start + text.length) {
        *failure = @"text-unavailable";
        return nil;
    }
    NSUInteger offset = (NSUInteger)(glyph.location - window_start);
    NSRange word = word_range(text, offset);
    if (word.location == NSNotFound) {
        *failure = @"word-unavailable";
        return nil;
    }

    CFRange global_word = CFRangeMake(window_start + word.location, word.length);
    AXValueRef word_parameter = AXValueCreate(kAXValueCFRangeType, &global_word);
    if (!word_parameter) {
        *failure = @"word-range-value";
        return nil;
    }
    CFTypeRef bounds_value = NULL;
    error = AXUIElementCopyParameterizedAttributeValue(
        element, kAXBoundsForRangeParameterizedAttribute, word_parameter, &bounds_value);
    CFRelease(word_parameter);
    if (error != kAXErrorSuccess || !bounds_value) {
        if (bounds_value) CFRelease(bounds_value);
        *failure = [NSString stringWithFormat:@"bounds-for-range:%d", error];
        return nil;
    }
    CGRect bounds = CGRectZero;
    BOOL valid_bounds = CFGetTypeID(bounds_value) == AXValueGetTypeID() &&
                        AXValueGetType(bounds_value) == kAXValueCGRectType &&
                        AXValueGetValue(bounds_value, kAXValueCGRectType, &bounds);
    CFRelease(bounds_value);
    if (!valid_bounds || bounds.size.width <= 0 || bounds.size.height <= 0) {
        *failure = @"invalid-word-bounds";
        return nil;
    }
    if (!word_bounds_at_point(element, text, word, window_start, point, &bounds)) {
        *failure = @"word-bounds-miss-pointer";
        return nil;
    }

    return lookup_result(text, offset, word, bounds, include_context);
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

// Shared across both hit tests and context expansion for one hover lookup.
static const CFIndex max_lookup_nodes = 500;

static BOOL admit_lookup_node(CFMutableSetRef nodes, AXUIElementRef element) {
    if (!nodes || CFSetContainsValue(nodes, element)) return YES;
    if (CFSetGetCount(nodes) >= max_lookup_nodes) return NO;
    CFSetAddValue(nodes, element);
    return YES;
}

// Chrome can split one paragraph into several AXStaticText nodes at a style
// boundary. Read the nearest inline container while retaining the hit node's
// word rectangle and its UTF-16 character offset.
static BOOL append_inline_text(AXUIElementRef element, AXUIElementRef target,
                               NSMutableString *text, NSUInteger depth,
                               NSUInteger *visited, NSUInteger *leaves,
                               NSUInteger *target_start, CFMutableSetRef nodes) {
    if (++*visited > 64 || depth > 4 || !admit_lookup_node(nodes, element)) return NO;
    NSString *role = string_attribute(element, kAXRoleAttribute);
    if ([role isEqualToString:@"AXStaticText"]) {
        NSString *value = string_attribute(element, kAXValueAttribute);
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
            append_inline_text((AXUIElementRef)child, target, text, depth + 1,
                               visited, leaves, target_start, nodes);
    }
    CFRelease(children);
    return complete;
}

// Merge only a complete hit-node value so its offset remains valid after
// preceding sibling text is added.
static NSDictionary *with_inline_context(AXUIElementRef target, NSDictionary *result,
                                         CFMutableSetRef nodes) {
    NSString *target_text = normalize_static_text(string_attribute(target, kAXValueAttribute));
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
        if (!admit_lookup_node(nodes, current)) break;

        NSMutableString *text = [NSMutableString string];
        NSUInteger visited = 0, leaves = 0, target_start = NSNotFound;
        if (append_inline_text(current, target, text, 0, &visited, &leaves, &target_start, nodes) &&
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
    CFTypeRef position_value = NULL, size_value = NULL;
    AXError position_error = AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &position_value);
    AXError size_error = AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &size_value);
    CGPoint position = CGPointZero;
    CGSize size = CGSizeZero;
    BOOL valid = position_error == kAXErrorSuccess && size_error == kAXErrorSuccess &&
                 position_value && size_value &&
                 CFGetTypeID(position_value) == AXValueGetTypeID() &&
                 CFGetTypeID(size_value) == AXValueGetTypeID() &&
                 AXValueGetType(position_value) == kAXValueCGPointType &&
                 AXValueGetType(size_value) == kAXValueCGSizeType &&
                 AXValueGetValue(position_value, kAXValueCGPointType, &position) &&
                 AXValueGetValue(size_value, kAXValueCGSizeType, &size) &&
                 size.width > 0 && size.height > 0;
    if (position_value) CFRelease(position_value);
    if (size_value) CFRelease(size_value);
    return valid ? (CGRect){position, size} : CGRectNull;
}

// Editable text keeps its own line breaks. Static text may have inline siblings.
static NSDictionary *lookup_text_node(AXUIElementRef element, NSString *role, CGPoint point,
                                      BOOL include_context, CFMutableSetRef nodes) {
    BOOL is_static = [role isEqualToString:@"AXStaticText"];
    if (!is_static && ![role isEqualToString:@"AXTextArea"]) return nil;
    NSDictionary *hit = text_by_word_bounds(element, point, include_context);
    if (!hit || !include_context || !is_static) return hit;
    NSMutableDictionary *normalized = [hit mutableCopy];
    normalized[@"text"] = normalize_static_text(hit[@"text"]);
    return with_inline_context(element, normalized, nodes);
}

static const CFIndex max_children_per_node = 100;
static const int max_ancestor_depth = 10;

// Search matching children one level at a time before moving outward.
static NSDictionary *text_by_descendant_word_bounds(AXUIElementRef element, CGPoint point,
                                                     BOOL include_context,
                                                     CFMutableSetRef visited,
                                                     CFMutableSetRef nodes, NSString **stop_reason) {
    if (CFSetContainsValue(visited, element)) return nil;
    CFSetAddValue(visited, element);
    NSString *root_value = string_attribute(element, kAXValueAttribute);
    NSString *root_title = string_attribute(element, kAXTitleAttribute);
    BOOL root_has_text = root_value.length > 0 || root_title.length > 0;
    if (root_has_text) {
        NSDictionary *result = lookup_text_node(element, string_attribute(element, kAXRoleAttribute),
                                                point, include_context, nodes);
        if (result) return result;
    }
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
                NSString *value = string_attribute((AXUIElementRef)child, kAXValueAttribute);
                NSString *title = string_attribute((AXUIElementRef)child, kAXTitleAttribute);
                NSString *role = string_attribute((AXUIElementRef)child, kAXRoleAttribute);
                if ([role isEqualToString:@"AXWebArea"]) {
                    continue;
                }
                BOOL has_text = value.length > 0 || title.length > 0;
                if (!has_text) {
                    [queue addObject:(__bridge id)child];
                    continue;
                }
                CGRect bounds = element_bounds((AXUIElementRef)child);
                BOOL contains_point = CGRectContainsPoint(bounds, point);
                if (!contains_point) continue;
                NSDictionary *result = lookup_text_node((AXUIElementRef)child, role, point, include_context, nodes);
                if (result) {
                    CFRelease(children_value);
                    return result;
                }
                [queue addObject:(__bridge id)child];
            }
        }
        CFRelease(children_value);
    }
    return nil;
}

// One attempt can request a fresh hit test before searching descendants.
static int read_accessible_text_once(double x, double y, int include_context,
                                     uint8_t **output, size_t *output_length,
                                     BOOL allow_retry, BOOL *retry, CFMutableSetRef nodes) {
    @autoreleasepool {
        if (!output || !output_length) return 0;
        *output = NULL;
        *output_length = 0;
        NSDictionary *result = nil;
        NSString *failure = @"accessibility-not-authorized";
        if (AXIsProcessTrusted()) {
            AXUIElementRef system = AXUIElementCreateSystemWide();
            AXUIElementSetMessagingTimeout(system, 0.3f);
            AXUIElementRef element = NULL;
            AXError hit_error = AXUIElementCopyElementAtPosition(
                system, (float)x, (float)y, &element);
            if (hit_error == kAXErrorSuccess && element) {
                CGPoint point = CGPointMake(x, y);
                NSMutableArray<NSString *> *attempts = [NSMutableArray array];
                CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
                // Expand through ancestors without repeatedly searching the same subtree.
                for (int depth = 0; element && !result; depth++) {
                    if (!admit_lookup_node(nodes, element)) {
                        [attempts addObject:@"node-limit:500"];
                        break;
                    }
                    AXUIElementSetMessagingTimeout(element, 0.3f);
                    CFTypeRef role_value = NULL;
                    AXUIElementCopyAttributeValue(element, kAXRoleAttribute, &role_value);
                    NSString *role = role_value && CFGetTypeID(role_value) == CFStringGetTypeID()
                        ? [(__bridge NSString *)role_value copy] : @"unknown";
                    if (role_value) CFRelease(role_value);
                    NSString *value = string_attribute(element, kAXValueAttribute);
                    NSString *title = string_attribute(element, kAXTitleAttribute);
                    if (depth == 0) {
                        NSString *subrole = string_attribute(element, kAXSubroleAttribute);
                        NSLog(@"[Accessibility] initial hit point=(%.1f, %.1f) role=%@ subrole=%@ value=%@ title=%@",
                              point.x, point.y, role, subrole ?: @"<unavailable>",
                              value ?: @"<unavailable>", title ?: @"<unavailable>");
                        if (allow_retry && [role isEqualToString:@"AXWebArea"]) {
                            NSLog(@"[Accessibility] initial hit retry reason=%@", role);
                            *retry = YES;
                            break;
                        }
                    }
                    // Stop before searching broad containers and their subtrees.
                    if ([role isEqualToString:@"AXWebArea"] ||
                        [role isEqualToString:@"AXWindow"] ||
                        [role isEqualToString:@"AXScrollArea"] ||
                        [role isEqualToString:@"AXApplication"]) {
                        [attempts addObject:[NSString stringWithFormat:@"%@: search-boundary", role]];
                        break;
                    }
                    if (depth == 0 && allow_retry &&
                        ([role isEqualToString:@"AXStaticText"] || [role isEqualToString:@"AXImage"])) {
                        CGRect bounds = element_bounds(element);
                        BOOL unavailable = CGRectIsNull(bounds);
                        if (unavailable || !CGRectContainsPoint(bounds, point)) {
                            NSLog(@"[Accessibility] initial hit retry reason=%@ bounds=%@",
                                  unavailable ? @"bounds-unavailable" :
                                      [role isEqualToString:@"AXImage"] ? @"image-bounds-miss" : @"static-text-bounds-miss",
                                  unavailable ? @"<unavailable>" : NSStringFromRect(NSRectFromCGRect(bounds)));
                            *retry = YES;
                            break;
                        }
                        NSLog(@"[Accessibility] initial hit node=%lu bounds=%@ decision=continue reason=point-inside-bounds",
                              (unsigned long)CFHash(element),
                              NSStringFromRect(NSRectFromCGRect(bounds)));
                    }
                    if (depth == 0 && [role isEqualToString:@"AXImage"]) {
                        [attempts addObject:@"AXImage: image-content"];
                        break;
                    }
                    NSString *attempt_failure = @"no-node-text";
                    AXError position_error = kAXErrorSuccess;
                    if (value.length > 0 || title.length > 0) {
                        result = text_at_point(element, point, include_context, &position_error,
                                               &attempt_failure);
                    }
                    if (result) {
                        if (include_context && [role isEqualToString:@"AXStaticText"]) {
                            NSMutableDictionary *normalized = [result mutableCopy];
                            normalized[@"text"] = normalize_static_text(result[@"text"]);
                            result = normalized;
                            result = with_inline_context(element, result, nodes);
                        }
                        break;
                    }
                    // A communication failure does not justify more calls into the same element.
                    if (position_error != kAXErrorCannotComplete) {
                        NSString *stop_reason = nil;
                        result = text_by_descendant_word_bounds(element, point,
                                                                include_context, visited, nodes, &stop_reason);
                        if (result) break;
                        if (stop_reason) {
                            [attempts addObject:stop_reason];
                            break;
                        }
                        attempt_failure = [attempt_failure stringByAppendingString:
                            @"; descendant-word-bounds-miss"];
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
                if (!result) failure = [attempts componentsJoinedByString:@"; "];
                if (element) CFRelease(element);
            } else if (element) {
                CFRelease(element);
            }
            if (!result && hit_error != kAXErrorSuccess) {
                failure = [NSString stringWithFormat:@"hit-test:%d", hit_error];
            }
            CFRelease(system);
        }
        return copy_json(@{@"result": result ?: NSNull.null,
                           @"failure": result ? NSNull.null : failure}, output, output_length);
    }
}

// Keep the retry delay on the N-API worker, including for our own windows.
int dictol_read_mac_accessible_text(double x, double y, int include_context,
                                    uint8_t **output, size_t *output_length) {
    BOOL own_window = !pthread_main_np() && point_is_inside_own_window(x, y);
    CFMutableSetRef nodes = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    __block BOOL retry = NO;
    __block int status = 0;
    void (^attempt)(BOOL) = ^(BOOL allow_retry) {
        if (own_window) {
            dispatch_sync(dispatch_get_main_queue(), ^{
                status = read_accessible_text_once(x, y, include_context, output, output_length,
                                                   allow_retry, &retry, nodes);
            });
        } else {
            status = read_accessible_text_once(x, y, include_context, output, output_length,
                                               allow_retry, &retry, nodes);
        }
    };
    attempt(YES);
    if (retry) {
        if (output && *output) {
            free(*output);
            *output = NULL;
        }
        NSLog(@"[Accessibility] retrying initial hit point=(%.1f, %.1f) delayMs=20", x, y);
        usleep(20000);
        retry = NO;
        attempt(NO);
    }
    CFRelease(nodes);
    return status;
}

// Read the selection from the focused element, optionally with its text window.
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
                    if (include_context) {
                        CFTypeRef range_value = NULL;
                        CFRange range = CFRangeMake(0, 0);
                        error = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute, &range_value);
                        BOOL valid = error == kAXErrorSuccess && range_value &&
                            CFGetTypeID(range_value) == AXValueGetTypeID() &&
                            AXValueGetType(range_value) == kAXValueCFRangeType &&
                            AXValueGetValue(range_value, kAXValueCFRangeType, &range) &&
                            range.location >= 0 && range.length > 0;
                        if (range_value) CFRelease(range_value);
                        if (valid) {
                            CFIndex start = 0;
                            NSString *text = text_near_position(element, range.location, &start);
                            if (text && range.location >= start && range.location - start < text.length) {
                                if ([string_attribute(element, kAXRoleAttribute) isEqualToString:@"AXStaticText"]) {
                                    text = normalize_static_text(text);
                                }
                                selection[@"text"] = text;
                                selection[@"offset"] = @(range.location - start);
                            }
                        }
                    }
                    result = selection;
                    if (selection[@"text"] &&
                        [string_attribute(element, kAXRoleAttribute) isEqualToString:@"AXStaticText"]) {
                        result = with_inline_context(element, selection, NULL);
                    }
                }
            } else {
                failure = [NSString stringWithFormat:@"focused-element:%d", error];
            }
            if (focused) CFRelease(focused);
            CFRelease(system);
        }
        return copy_json(@{ @"result": result ?: NSNull.null,
                            @"failure": result ? NSNull.null : failure }, output, output_length);
    }
}

void dictol_free_mac_accessible_text(uint8_t *bytes) {
    free(bytes);
}
