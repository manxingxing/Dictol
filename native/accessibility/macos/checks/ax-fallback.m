#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
static AXError mock_position_error;
static BOOL mock_empty_range;
static int mock_bounds_calls;
static AXUIElementRef mock_nodes[5];
static AXUIElementRef mock_sibling;
static AXUIElementRef mock_after_group;
static AXUIElementRef mock_after_word;
static BOOL mock_ancestor_search;
static BOOL mock_descendant_search;
static BOOL mock_ancestor_web_area;
static int mock_web_area_children_reads;
static int mock_root_children_reads;
static CFStringRef mock_boundary_role;
static CFStringRef mock_boundary_subrole;
static int mock_parent_reads;
static int mock_position_calls;
static int mock_original_bounds_calls;
static BOOL mock_bounds_off_target;
static BOOL mock_wrapped_word;
static BOOL mock_newline;
static BOOL mock_selection;
static BOOL mock_selection_no_range;
static BOOL mock_selection_empty;
static BOOL mock_geometry_search;
static BOOL mock_geometry_shallow_hit;
static BOOL mock_geometry_empty_group;
static BOOL mock_ancestor_empty_group;
static int mock_empty_group_geometry_reads;
static int mock_empty_group_position_calls;
static AXUIElementRef mock_geometry_nodes[7];
static int mock_geometry_children_reads[7];
static int mock_geometry_bounds_calls[7];
static BOOL mock_many_skipped;
static BOOL mock_many_searchable;
static int mock_many_expanded;
static int mock_visible_reads;
static int mock_hit_calls;
static BOOL mock_retry_updates_hit;
static BOOL mock_node_off_target;
static BOOL mock_node_bounds_unavailable;
static BOOL mock_node_size_invalid;
static BOOL mock_nested_web_area;
static CFIndex mock_branch_size;
static BOOL mock_deep_chain;
static AXUIElementRef mock_skipped_nodes[40];
static Boolean mock_trusted(void) { return true; }
static AXUIElementRef mock_system(void) { return (AXUIElementRef)CFRetain(CFSTR("system")); }
static AXError mock_timeout(AXUIElementRef element, float timeout) { return kAXErrorSuccess; }
static AXError mock_hit(AXUIElementRef system, float x, float y, AXUIElementRef *element) {
    mock_hit_calls++;
    if (mock_retry_updates_hit && mock_hit_calls == 2) {
        mock_boundary_role = CFSTR("AXStaticText");
        mock_node_off_target = NO;
    }
    *element = mock_geometry_search ? (AXUIElementRef)CFRetain(mock_geometry_nodes[0])
        : mock_descendant_search ? (AXUIElementRef)CFRetain(mock_nodes[0])
        : mock_ancestor_search ? (AXUIElementRef)CFRetain(mock_nodes[4])
                               : (AXUIElementRef)CFRetain(CFSTR("element"));
    return kAXErrorSuccess;
}
static AXError mock_attribute(AXUIElementRef element, CFStringRef attribute, CFTypeRef *value) {
    if (mock_descendant_search && CFEqual(attribute, kAXParentAttribute)) mock_parent_reads++;
    if (mock_deep_chain) {
        if (CFEqual(attribute, kAXRoleAttribute)) {
            *value = CFRetain(CFSTR("AXGroup"));
            return kAXErrorSuccess;
        }
        if (CFEqual(attribute, kAXParentAttribute)) {
            *value = AXUIElementCreateApplication(5000 + mock_parent_reads);
            return kAXErrorSuccess;
        }
        return kAXErrorNoValue;
    }
    if (mock_branch_size && element == mock_nodes[1] && CFEqual(attribute, kAXChildrenAttribute)) {
        const void *children[101];
        for (CFIndex i = 0; i < mock_branch_size; i++) children[i] = mock_nodes[4];
        *value = CFArrayCreate(NULL, children, mock_branch_size, &kCFTypeArrayCallBacks);
        return kAXErrorSuccess;
    }
    if (mock_after_group && element == mock_after_group) {
        if (CFEqual(attribute, kAXRoleAttribute)) {
            *value = CFRetain(CFSTR("AXGroup")); return kAXErrorSuccess;
        }
        if (CFEqual(attribute, kAXValueAttribute) || CFEqual(attribute, kAXTitleAttribute)) {
            *value = CFRetain(CFSTR("")); return kAXErrorSuccess;
        }
        if (CFEqual(attribute, kAXChildrenAttribute)) {
            const void *children[] = {mock_after_word};
            *value = CFArrayCreate(kCFAllocatorDefault, children, 1, &kCFTypeArrayCallBacks);
            return kAXErrorSuccess;
        }
    }
    if (mock_many_skipped) {
        if (element == mock_geometry_nodes[0] && CFEqual(attribute, kAXChildrenAttribute)) {
            const void *children[41];
            for (int i = 0; i < 40; i++) children[i] = mock_skipped_nodes[i];
            children[40] = mock_geometry_nodes[4];
            *value = CFArrayCreate(kCFAllocatorDefault, children, 41, &kCFTypeArrayCallBacks);
            return kAXErrorSuccess;
        }
        for (int i = 0; i < 40; i++) {
            if (element != mock_skipped_nodes[i]) continue;
            if (CFEqual(attribute, kAXRoleAttribute)) {
                *value = CFRetain(CFSTR("AXStaticText")); return kAXErrorSuccess;
            }
            if (CFEqual(attribute, kAXValueAttribute)) {
                *value = CFRetain(mock_many_searchable ? CFSTR("") : CFSTR("offscreen")); return kAXErrorSuccess;
            }
            if (CFEqual(attribute, kAXChildrenAttribute)) {
                mock_many_expanded++;
                return kAXErrorNoValue;
            }
            if (CFEqual(attribute, kAXPositionAttribute)) {
                CGPoint position = CGPointMake(300, 0);
                *value = AXValueCreate(kAXValueCGPointType, &position); return kAXErrorSuccess;
            }
            if (CFEqual(attribute, kAXSizeAttribute)) {
                CGSize size = CGSizeMake(20, 20);
                *value = AXValueCreate(kAXValueCGSizeType, &size); return kAXErrorSuccess;
            }
        }
    }
    if (mock_geometry_search) {
        for (int i = 0; i < 7; i++) {
            if (element != mock_geometry_nodes[i]) continue;
            if (i == 0 && CFEqual(attribute, kAXVisibleChildrenAttribute)) {
                const void *children[] = {mock_geometry_nodes[4]};
                *value = CFArrayCreate(kCFAllocatorDefault, children, 1, &kCFTypeArrayCallBacks);
                mock_visible_reads++;
                return kAXErrorSuccess;
            }
            if (mock_geometry_empty_group && i == 3) {
                if (CFEqual(attribute, kAXValueAttribute) || CFEqual(attribute, kAXTitleAttribute)) {
                    *value = CFRetain(CFSTR("")); return kAXErrorSuccess;
                }
                if (CFEqual(attribute, kAXPositionAttribute) || CFEqual(attribute, kAXSizeAttribute)) {
                    mock_empty_group_geometry_reads++;
                }
            }
            if (CFEqual(attribute, kAXRoleAttribute)) {
                *value = CFRetain(i == 0 ? CFSTR("AXWebArea")
                    : (i >= 5 || (i == 4 && mock_geometry_shallow_hit))
                        ? CFSTR("AXStaticText") : CFSTR("AXGroup"));
                return kAXErrorSuccess;
            }
            if (CFEqual(attribute, kAXChildrenAttribute)) {
                mock_geometry_children_reads[i]++;
                if (i == 0) {
                    const void *children[] = {mock_geometry_nodes[1], mock_geometry_nodes[2],
                                              mock_geometry_nodes[3], mock_geometry_nodes[4],
                                              CFSTR("invalid"), mock_geometry_nodes[3]};
                    *value = CFArrayCreate(kCFAllocatorDefault, children, 6, &kCFTypeArrayCallBacks);
                    return kAXErrorSuccess;
                }
                if (i == 3 || (i == 4 && !mock_geometry_shallow_hit)) {
                    const void *children[] = {mock_geometry_nodes[i == 3 ? 5 : 6]};
                    *value = CFArrayCreate(kCFAllocatorDefault, children, 1, &kCFTypeArrayCallBacks);
                    return kAXErrorSuccess;
                }
                return kAXErrorNoValue;
            }
            if (i == 2 && (CFEqual(attribute, kAXPositionAttribute) ||
                           CFEqual(attribute, kAXSizeAttribute))) return kAXErrorNoValue;
            if (CFEqual(attribute, kAXPositionAttribute)) {
                CGPoint position = CGPointMake(i == 1 ? 300 : 0, 0);
                *value = AXValueCreate(kAXValueCGPointType, &position); return kAXErrorSuccess;
            }
            if (CFEqual(attribute, kAXSizeAttribute)) {
                CGSize size = CGSizeMake(200, 100);
                *value = AXValueCreate(kAXValueCGSizeType, &size); return kAXErrorSuccess;
            }
            break;
        }
    }
    if (mock_ancestor_empty_group && element == mock_nodes[3] &&
        (CFEqual(attribute, kAXValueAttribute) || CFEqual(attribute, kAXTitleAttribute))) {
        *value = CFRetain(CFSTR("")); return kAXErrorSuccess;
    }
    if (CFEqual(attribute, kAXPositionAttribute)) {
        if (mock_node_bounds_unavailable) return kAXErrorNoValue;
        CGPoint position = mock_node_off_target ? CGPointMake(300, 0) : CGPointZero;
        *value = AXValueCreate(kAXValueCGPointType, &position); return kAXErrorSuccess;
    }
    if (CFEqual(attribute, kAXSizeAttribute)) {
        CGSize size = mock_node_size_invalid ? CGSizeZero : CGSizeMake(200, 100);
        *value = AXValueCreate(kAXValueCGSizeType, &size); return kAXErrorSuccess;
    }
    if (mock_selection && CFEqual(attribute, kAXFocusedUIElementAttribute)) {
        *value = CFRetain(mock_nodes[4]); return kAXErrorSuccess;
    }
    if (mock_selection && element == mock_nodes[4]) {
        if (CFEqual(attribute, kAXSelectedTextAttribute)) {
            *value = CFRetain(mock_selection_empty ? CFSTR("") : CFSTR("world")); return kAXErrorSuccess;
        }
        if (CFEqual(attribute, kAXSelectedTextRangeAttribute)) {
            if (mock_selection_no_range) return kAXErrorAttributeUnsupported;
            CFRange range = CFRangeMake(6, 5);
            *value = AXValueCreate(kAXValueCFRangeType, &range); return kAXErrorSuccess;
        }
    }
    for (int i = 0; i < 5; i++) {
        if (!mock_nodes[i] || element != mock_nodes[i]) continue;
        if (mock_descendant_search && i == 0 && mock_boundary_subrole &&
            CFEqual(attribute, kAXSubroleAttribute)) {
            *value = CFRetain(mock_boundary_subrole); return kAXErrorSuccess;
        }
        if (CFEqual(attribute, kAXRoleAttribute)) {
            CFStringRef role = i == 4 ? CFSTR("AXStaticText")
                : mock_descendant_search && i == 0 ? mock_boundary_role
                : mock_descendant_search && i == 1 && mock_nested_web_area ? CFSTR("AXWebArea")
                : mock_descendant_search && i == 2 ? CFSTR("AXHeading")
                : mock_ancestor_web_area && i == 1 ? CFSTR("AXWebArea")
                : i == 1 ? CFSTR("AXLink") : CFSTR("AXGroup");
            *value = CFRetain(role);
            return kAXErrorSuccess;
        }
        if (CFEqual(attribute, kAXChildrenAttribute) && i < 4) {
            if (mock_descendant_search && i == 0) mock_root_children_reads++;
            if ((mock_ancestor_web_area || mock_nested_web_area) && i == 1) mock_web_area_children_reads++;
            if (i == 0 && mock_branch_size == 101 && mock_after_group) {
                const void *children[] = {mock_nodes[1], mock_after_group};
                *value = CFArrayCreate(kCFAllocatorDefault, children, 2, &kCFTypeArrayCallBacks);
                return kAXErrorSuccess;
            }
            const void *children[] = {mock_nodes[i + 1], mock_sibling};
            CFIndex count = i == 0 && mock_ancestor_search ? 2 : 1;
            *value = CFArrayCreate(kCFAllocatorDefault, children, count, &kCFTypeArrayCallBacks);
            return kAXErrorSuccess;
        }
        if (CFEqual(attribute, kAXParentAttribute) && i > 0) {
            *value = CFRetain(mock_nodes[i - 1]);
            return kAXErrorSuccess;
        }
        break;
    }
    if (CFEqual(attribute, kAXRoleAttribute)) { *value = CFRetain(CFSTR("AXStaticText")); return kAXErrorSuccess; }
    if (CFEqual(attribute, kAXValueAttribute)) {
        *value = CFRetain(mock_wrapped_word ? CFSTR("もる target")
                          : mock_newline ? CFSTR("hello\nworld") : CFSTR("hello world"));
        return kAXErrorSuccess;
    }
    return kAXErrorNoValue;
}
static AXError mock_parameterized(AXUIElementRef element, CFStringRef attribute, CFTypeRef parameter, CFTypeRef *value) {
    if (CFEqual(attribute, kAXRangeForPositionParameterizedAttribute)) {
        mock_position_calls++;
        if (mock_ancestor_empty_group && element == mock_nodes[3]) mock_empty_group_position_calls++;
        if (mock_position_error != kAXErrorSuccess) return mock_position_error;
        CFRange range = CFRangeMake(6, mock_empty_range ? 0 : 1);
        *value = AXValueCreate(kAXValueCFRangeType, &range); return kAXErrorSuccess;
    }
    if (CFEqual(attribute, kAXBoundsForRangeParameterizedAttribute)) {
        mock_bounds_calls++;
        if (mock_geometry_search) {
            for (int i = 0; i < 7; i++) {
                if (element == mock_geometry_nodes[i]) mock_geometry_bounds_calls[i]++;
            }
        }
        if (mock_ancestor_search && element == mock_nodes[4]) mock_original_bounds_calls++;
        CFRange range; AXValueGetValue((AXValueRef)parameter, kAXValueCFRangeType, &range);
        if (mock_wrapped_word) {
            CGRect rect = range.location >= 3
                ? CGRectMake(1500 + (range.location - 3) * 10, 540, range.length * 10, 19)
                : range.length > 1 ? CGRectMake(1308, 516, 644, 43)
                : range.location == 0 ? CGRectMake(1936, 516, 16, 19)
                                      : CGRectMake(1308, 540, 17, 19);
            *value = AXValueCreate(kAXValueCGRectType, &rect); return kAXErrorSuccess;
        }
        CGFloat origin = mock_bounds_off_target || (mock_ancestor_search && element == mock_nodes[4]) ||
                         (mock_geometry_search && !mock_geometry_shallow_hit && !mock_geometry_empty_group &&
                          element == mock_geometry_nodes[5]) ? 200 : 0;
        CGRect rect = CGRectMake(origin + range.location * 10, 0, range.length * 10, 20);
        *value = AXValueCreate(kAXValueCGRectType, &rect); return kAXErrorSuccess;
    }
    return kAXErrorParameterizedAttributeUnsupported;
}
#define AXIsProcessTrusted mock_trusted
#define AXUIElementCreateSystemWide mock_system
#define AXUIElementSetMessagingTimeout mock_timeout
#define AXUIElementCopyElementAtPosition mock_hit
#define AXUIElementCopyAttributeValue mock_attribute
#define AXUIElementCopyParameterizedAttributeValue mock_parameterized
#import "../src/accessibility.m"
static NSDictionary *run(AXError error, BOOL empty, BOOL context) {
    mock_position_error = error; mock_empty_range = empty; mock_bounds_calls = 0;
    uint8_t *bytes = NULL; size_t length = 0;
    NSCAssert(dictol_read_mac_accessible_text(65, 10, context, &bytes, &length), @"lookup failed");
    NSData *data = [NSData dataWithBytes:bytes length:length]; free(bytes);
    return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}
static NSDictionary *run_selection(BOOL context) {
    uint8_t *bytes = NULL; size_t length = 0;
    NSCAssert(dictol_read_mac_accessible_selection(context, &bytes, &length), @"selection lookup failed");
    NSData *data = [NSData dataWithBytes:bytes length:length]; free(bytes);
    return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}
static NSDictionary *run_geometry_search(void) {
    mock_position_error = kAXErrorParameterizedAttributeUnsupported;
    CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    NSString *stop_reason = nil;
    NSDictionary *result = text_by_descendant_word_bounds(mock_geometry_nodes[0],
                                                          CGPointMake(65, 10), NO,
                                                          visited, NULL, &stop_reason);
    CFRelease(visited);
    return @{@"result": result ?: NSNull.null};
}
int main(void) { @autoreleasepool {
    NSDictionary *result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"], @"unsupported did not hit word");
    NSCAssert(result[@"result"][@"text"] == nil && mock_bounds_calls > 0, @"dictionary contract");
    result = run(kAXErrorParameterizedAttributeUnsupported, NO, YES);
    NSCAssert([result[@"result"][@"text"] isEqualToString:@"hello world"] && [result[@"result"][@"offset"] intValue] == 6, @"AI contract");
    result = run(kAXErrorSuccess, YES, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"], @"empty range regression");
    CGRect tolerance_bounds = CGRectMake(60, 0, 50, 20);
    NSCAssert(word_bounds_at_point(NULL, @"world", NSMakeRange(0, 5), 0,
                                  CGPointMake(65, -5), &tolerance_bounds), @"word tolerance missed");
    NSCAssert(!word_bounds_at_point(NULL, @"world", NSMakeRange(0, 5), 0,
                                   CGPointMake(65, -7), &tolerance_bounds), @"word tolerance too large");
    mock_position_error = kAXErrorParameterizedAttributeUnsupported;
    NSCAssert([text_by_word_bounds(NULL, CGPointMake(65, -2.5), NO)[@"word"] isEqualToString:@"world"],
              @"token tolerance missed");
    NSCAssert(!text_by_word_bounds(NULL, CGPointMake(65, -3.5), NO), @"token tolerance too large");
    mock_newline = YES;
    for (NSNumber *error in @[@(kAXErrorSuccess), @(kAXErrorParameterizedAttributeUnsupported)]) {
        result = run((AXError)error.intValue, NO, YES);
        NSCAssert([result[@"result"][@"text"] isEqualToString:@"hello world"] &&
                  [result[@"result"][@"offset"] intValue] == 6 &&
                  [result[@"result"][@"word"] isEqualToString:@"world"],
                  @"static text newline normalization failed");
    }
    mock_newline = NO;
    result = run(kAXErrorCannotComplete, NO, NO);
    NSCAssert(result[@"result"] == NSNull.null && mock_bounds_calls == 0, @"unexpected fallback on communication failure");
    mock_wrapped_word = YES;
    CGRect bounds = CGRectMake(1308, 516, 644, 43);
    mock_bounds_calls = 0;
    NSCAssert(!word_bounds_at_point(NULL, @"もる", NSMakeRange(0, 2), 0,
                                   CGPointMake(1556, 552), &bounds), @"wrapped word matched empty space");
    NSCAssert(mock_bounds_calls == 2, @"wrapped word bounds were queried twice");
    bounds = CGRectMake(1308, 516, 644, 43);
    NSCAssert(word_bounds_at_point(NULL, @"もる", NSMakeRange(0, 2), 0,
                                  CGPointMake(1940, 525), &bounds) &&
              CGRectEqualToRect(bounds, CGRectMake(1936, 516, 16, 19)), @"first line bounds failed");
    bounds = CGRectMake(1308, 516, 644, 43);
    NSCAssert(word_bounds_at_point(NULL, @"もる", NSMakeRange(0, 2), 0,
                                  CGPointMake(1315, 550), &bounds) &&
              CGRectEqualToRect(bounds, CGRectMake(1308, 540, 17, 19)), @"second line bounds failed");
    mock_position_error = kAXErrorParameterizedAttributeUnsupported;
    uint8_t *bytes = NULL; size_t length = 0;
    NSCAssert(dictol_read_mac_accessible_text(1556, 552, NO, &bytes, &length), @"wrapped lookup failed");
    NSData *data = [NSData dataWithBytes:bytes length:length]; free(bytes);
    result = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"target"], @"wrapped word hid the target");
    mock_wrapped_word = NO;
    for (int i = 0; i < 5; i++) mock_nodes[i] = AXUIElementCreateApplication(1000 + i);
    mock_after_group = AXUIElementCreateApplication(7000);
    mock_after_word = AXUIElementCreateApplication(7001);
    for (int i = 0; i < 7; i++) mock_geometry_nodes[i] = AXUIElementCreateApplication(3000 + i);
    mock_geometry_search = YES;
    mock_geometry_shallow_hit = YES;
    mock_geometry_children_reads[3] = 0;
    result = run_geometry_search();
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"] &&
              mock_geometry_bounds_calls[4] > 0 && mock_geometry_bounds_calls[5] == 0 &&
              mock_geometry_children_reads[3] == 0,
              @"matching text was not checked before unrelated queued subtrees");
    NSCAssert(mock_geometry_children_reads[1] == 0 && mock_geometry_children_reads[2] == 0,
              @"offscreen or unbounded subtree was traversed");
    mock_geometry_shallow_hit = NO;
    mock_geometry_bounds_calls[5] = 0;
    result = run_geometry_search();
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"] &&
              mock_geometry_bounds_calls[5] == 2 && mock_geometry_bounds_calls[6] > 0,
              @"search did not continue after a text miss or checked it twice");
    mock_geometry_empty_group = YES;
    mock_empty_group_geometry_reads = 0;
    mock_geometry_children_reads[3] = 0;
    mock_geometry_bounds_calls[5] = 0;
    result = run_geometry_search();
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"] &&
              mock_empty_group_geometry_reads == 0 && mock_geometry_children_reads[3] > 0 &&
              mock_geometry_bounds_calls[5] > 0, @"empty container subtree not searched");
    mock_geometry_empty_group = NO;
    for (int i = 0; i < 40; i++) mock_skipped_nodes[i] = AXUIElementCreateApplication(4000 + i);
    mock_many_skipped = YES;
    mock_geometry_shallow_hit = YES;
    result = run_geometry_search();
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"],
              @"skipped nodes exhausted the search budget");
    mock_many_searchable = YES;
    mock_geometry_shallow_hit = NO;
    mock_many_expanded = 0;
    result = run_geometry_search();
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"] &&
              mock_many_expanded == 40 && mock_visible_reads == 0,
              @"search did not continue past 32 searchable nodes");
    mock_many_searchable = NO;
    mock_many_skipped = NO;
    for (int i = 0; i < 40; i++) CFRelease(mock_skipped_nodes[i]);
    mock_geometry_search = NO;
    for (int i = 0; i < 7; i++) CFRelease(mock_geometry_nodes[i]);
    mock_selection = YES;
    mock_newline = YES;
    result = run_selection(NO);
    NSCAssert([result[@"result"][@"selectedText"] isEqualToString:@"world"] &&
              result[@"result"][@"text"] == nil, @"selection without context failed");
    result = run_selection(YES);
    NSCAssert([result[@"result"][@"text"] isEqualToString:@"hello world"] &&
              [result[@"result"][@"offset"] intValue] == 6, @"selection context failed");
    mock_selection_no_range = YES;
    result = run_selection(YES);
    NSCAssert([result[@"result"][@"selectedText"] isEqualToString:@"world"] &&
              result[@"result"][@"text"] == nil, @"selection without range failed");
    mock_selection_empty = YES;
    result = run_selection(NO);
    NSCAssert(result[@"result"] == NSNull.null &&
              [result[@"failure"] isEqualToString:@"selected-text-unavailable"], @"empty selection failed");
    mock_selection = NO;
    mock_newline = NO;
    CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    NSString *stop_reason = nil;
    result = text_by_descendant_word_bounds(mock_nodes[0], CGPointMake(65, 10), NO, visited, NULL, &stop_reason);
    NSCAssert([result[@"word"] isEqualToString:@"world"] && CFSetGetCount(visited) == 5, @"nested style lookup failed");
    NSCAssert(!text_by_descendant_word_bounds(mock_nodes[0], CGPointMake(65, 10), NO, visited, NULL, &stop_reason), @"subtree was scanned twice");
    CFRelease(visited);
    visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    for (int i = 0; i < 32; i++) {
        NSNumber *item = @(i);
        CFSetAddValue(visited, (__bridge CFTypeRef)item);
    }
    result = text_by_descendant_word_bounds(mock_nodes[0], CGPointMake(65, 10), NO, visited, NULL, &stop_reason);
    NSCAssert([result[@"word"] isEqualToString:@"world"] && !stop_reason,
              @"search limit was not disabled");
    CFRelease(visited);
    mock_descendant_search = YES;
    // The nested style fixture has five distinct nodes including the initial hit.
    mock_boundary_role = CFSTR("AXGroup");
    for (int existing = 495; existing <= 496; existing++) {
        CFMutableSetRef nodes = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
        for (int i = 0; i < existing; i++) CFSetAddValue(nodes, (__bridge CFTypeRef)@(i));
        mock_position_error = kAXErrorParameterizedAttributeUnsupported;
        mock_parent_reads = 0;
        BOOL retry = NO;
        uint8_t *json = NULL;
        size_t length = 0;
        NSCAssert(read_accessible_text_once(65, 10, NO, &json, &length, YES, &retry, nodes),
                  @"lookup did not complete");
        NSData *data = [NSData dataWithBytes:json length:length];
        free(json);
        result = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        NSCAssert(CFSetGetCount(nodes) == 500 && !retry && mock_parent_reads == 0,
                  @"incorrect total traversal budget");
        if (existing == 495) {
            NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"], @"500th node should be usable");
        } else {
            NSCAssert(result[@"result"] == NSNull.null && [result[@"failure"] hasSuffix:@"node-limit:500"],
                      @"501st node should stop the lookup");
        }
        NSCAssert(admit_lookup_node(nodes, mock_nodes[0]), @"revisiting the initial hit costs no extra slot");
        CFRelease(nodes);
    }
    mock_deep_chain = YES;
    mock_parent_reads = 0;
    result = run(kAXErrorSuccess, NO, NO);
    NSCAssert(mock_parent_reads == 10 && [result[@"failure"] hasSuffix:@"ancestor-depth-limit"],
              @"ancestor traversal should stop after 10 parent reads");
    mock_deep_chain = NO;
    mock_boundary_role = CFSTR("AXGroup");
    mock_branch_size = 100;
    result = run(kAXErrorSuccess, YES, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"], @"100 children should be searched");
    mock_parent_reads = 0;
    mock_branch_size = 101;
    result = run(kAXErrorSuccess, YES, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"],
              @"oversized node should be skipped and the later branch searched");
    mock_branch_size = 0;
    mock_retry_updates_hit = YES;
    for (NSString *role in @[@"AXWebArea", @"AXImage"]) {
        mock_hit_calls = 0;
        mock_boundary_role = (__bridge CFStringRef)role;
        mock_node_off_target = [role isEqualToString:@"AXImage"];
        result = run(kAXErrorSuccess, NO, NO);
        NSCAssert(mock_hit_calls == 2 && [result[@"result"][@"word"] isEqualToString:@"world"],
                  @"retry after %@ did not use the updated hit", role);
    }
    mock_hit_calls = 0;
    mock_boundary_role = CFSTR("AXStaticText");
    mock_node_off_target = YES;
    result = run(kAXErrorSuccess, NO, NO);
    NSCAssert(mock_hit_calls == 2 && [result[@"result"][@"word"] isEqualToString:@"world"],
              @"off-target node retry did not use the updated hit");
    mock_hit_calls = 0;
    result = run(kAXErrorSuccess, NO, NO);
    NSCAssert(mock_hit_calls == 1 && [result[@"result"][@"word"] isEqualToString:@"world"],
              @"successful initial hit was retried");
    mock_retry_updates_hit = NO;
    mock_boundary_role = CFSTR("AXImage");
    for (NSUInteger scenario = 0; scenario < 3; scenario++) {
        mock_node_bounds_unavailable = scenario == 0;
        mock_node_size_invalid = scenario == 1;
        mock_node_off_target = scenario == 2;
        mock_hit_calls = 0;
        result = run(kAXErrorSuccess, NO, NO);
        NSCAssert(mock_hit_calls == 2 && [result[@"failure"] isEqualToString:@"AXImage: image-content"],
                  @"image with unusable or off-target bounds should retry once");
    }
    mock_node_bounds_unavailable = NO;
    mock_node_size_invalid = NO;
    mock_node_off_target = NO;
    mock_boundary_role = CFSTR("AXStaticText");
    for (NSNumber *unavailable in @[@NO, @YES]) {
        mock_node_bounds_unavailable = unavailable.boolValue;
        mock_hit_calls = 0;
        result = run(kAXErrorSuccess, YES, NO);
        NSCAssert(mock_hit_calls == (unavailable.boolValue ? 2 : 1) &&
                  [result[@"result"][@"word"] isEqualToString:@"world"],
                  @"only unavailable node bounds should trigger a retry before word lookup");
    }
    mock_node_bounds_unavailable = NO;
    mock_boundary_role = CFSTR("AXTextArea");
    mock_newline = YES;
    for (NSNumber *context in @[@NO, @YES]) {
        mock_parent_reads = mock_root_children_reads = mock_hit_calls = 0;
        result = run(kAXErrorSuccess, YES, context.boolValue);
        NSDictionary *hit = result[@"result"];
        NSCAssert([hit[@"word"] isEqualToString:@"world"] && mock_hit_calls == 1 &&
                  mock_root_children_reads == 0 && mock_parent_reads == 0,
                  @"textarea word should be resolved on the initial element");
        NSCAssert(context.boolValue ? ([hit[@"text"] isEqualToString:@"hello\nworld"] &&
                                      [hit[@"offset"] intValue] == 6) : hit[@"text"] == nil,
                  @"textarea context should preserve editable text");
    }
    mock_newline = NO;
    mock_bounds_off_target = YES;
    result = run(kAXErrorSuccess, YES, NO);
    NSCAssert(result[@"result"] == NSNull.null && mock_parent_reads == 0,
              @"textarea miss should not search outside the control");
    mock_bounds_off_target = NO;
    mock_nested_web_area = YES;
    mock_boundary_role = CFSTR("AXGroup");
    mock_web_area_children_reads = 0;
    result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
    NSCAssert(result[@"result"] == NSNull.null && mock_web_area_children_reads == 0,
              @"nested web area was searched inward");
    mock_nested_web_area = NO;
    mock_parent_reads = 0;
    mock_root_children_reads = 0;
    for (NSNumber *context in @[@NO, @YES]) {
        mock_parent_reads = 0;
        mock_root_children_reads = 0;
        mock_boundary_role = CFSTR("AXImage");
        mock_hit_calls = 0;
        mock_boundary_subrole = NULL;
        mock_position_calls = 0;
        result = run(kAXErrorParameterizedAttributeUnsupported, NO, context.boolValue);
        NSCAssert(mock_hit_calls == 1 && result[@"result"] == NSNull.null &&
                  [result[@"failure"] isEqualToString:@"AXImage: image-content"] &&
                  mock_position_calls == 0 && mock_root_children_reads == 0 && mock_parent_reads == 0,
                  @"image containing the pointer should return image-content without retrying");
        mock_boundary_role = CFSTR("AXGroup");
        mock_boundary_subrole = CFSTR("AXVideo");
        result = run(kAXErrorParameterizedAttributeUnsupported, NO, context.boolValue);
        NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"] &&
                  mock_position_calls > 0 && mock_root_children_reads > 0,
                  @"video subrole did not follow the normal search path");
    }
    mock_boundary_subrole = NULL;
    mock_parent_reads = 0;
    mock_root_children_reads = 0;
    mock_boundary_role = CFSTR("AXWebArea");
    for (NSNumber *context in @[@NO, @YES]) {
        result = run(kAXErrorParameterizedAttributeUnsupported, NO, context.boolValue);
        NSCAssert(result[@"result"] == NSNull.null &&
                  [result[@"failure"] isEqualToString:@"AXWebArea: search-boundary"] &&
                  mock_root_children_reads == 0 && mock_parent_reads == 0,
                  @"web area search did not stop at the boundary");
    }
    mock_parent_reads = 0;
    mock_bounds_off_target = YES;
    result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
    NSCAssert(result[@"result"] == NSNull.null &&
              [result[@"failure"] isEqualToString:@"AXWebArea: search-boundary"] &&
              mock_parent_reads == 0, @"web area miss searched outward");
    mock_bounds_off_target = NO;
    mock_parent_reads = 0;
    for (NSString *role in @[@"AXWindow", @"AXApplication", @"AXScrollArea"]) {
        mock_boundary_role = (__bridge CFStringRef)role;
        result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
        NSCAssert(result[@"result"] == NSNull.null && mock_bounds_calls == 0 &&
                  [result[@"failure"] isEqualToString:[role stringByAppendingString:@": search-boundary"]],
                  @"search did not stop at boundary");
        NSCAssert(mock_parent_reads == 0, @"searched beyond boundary");
    }
    mock_descendant_search = NO;
    mock_sibling = AXUIElementCreateApplication(2000);
    mock_ancestor_search = YES;
    mock_ancestor_empty_group = YES;
    mock_empty_group_position_calls = 0;
    result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"] &&
              mock_empty_group_position_calls == 0, @"empty ancestor was searched directly");
    mock_ancestor_empty_group = NO;
    mock_ancestor_web_area = YES;
    mock_web_area_children_reads = 0;
    result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
    NSCAssert(result[@"result"] == NSNull.null &&
              [result[@"failure"] hasSuffix:@"AXWebArea: search-boundary"] &&
              mock_web_area_children_reads == 0, @"ancestor web area was searched inward");
    mock_ancestor_web_area = NO;
    mock_original_bounds_calls = 0;
    result = run(kAXErrorSuccess, YES, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"], @"ancestor sibling lookup failed");
    NSCAssert(mock_original_bounds_calls == 2, @"original subtree was searched again");
    mock_original_bounds_calls = 0;
    result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"], @"unsupported ancestor lookup failed");
    NSCAssert(mock_original_bounds_calls == 2, @"unsupported subtree was searched again");
    CFRelease(mock_sibling);
    mock_ancestor_search = NO;
    for (int i = 0; i < 5; i++) CFRelease(mock_nodes[i]);
    CFRelease(mock_after_group);
    CFRelease(mock_after_word);
    NSLog(@"AX fallback integration scenarios passed");
} return 0; }
