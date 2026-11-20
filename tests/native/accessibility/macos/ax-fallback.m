#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#include <pthread.h>
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
static BOOL mock_ancestor_image;
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
static BOOL mock_inline_context;
static BOOL mock_hit_selected_node;
static NSString *mock_inline_value;
static BOOL mock_geometry_search;
static BOOL mock_geometry_shallow_hit;
static BOOL mock_geometry_empty_group;
static int mock_empty_group_bounds_case;
static BOOL mock_ancestor_empty_group;
static int mock_empty_group_geometry_reads;
static int mock_empty_group_position_calls;
static AXUIElementRef mock_geometry_nodes[7];
static int mock_geometry_children_reads[7];
static int mock_geometry_bounds_calls[7];
static BOOL mock_many_skipped;
static BOOL mock_many_searchable;
static BOOL mock_many_containing;
static int mock_many_expanded;
static int mock_visible_reads;
static int mock_hit_calls;
static int mock_accessibility_requests;
static int mock_manual_accessibility_requests;
static AXUIElementRef mock_observed_node;
static NSString *mock_direct_text;
static CFIndex mock_direct_offset;
static int mock_observed_value_reads;
static int mock_observed_title_reads;
static int mock_observed_position_calls;
static int mock_observed_bounds_calls;
static AXError mock_bounds_error;
static BOOL mock_invalid_bounds;
static BOOL mock_retry_updates_hit;
static int mock_retry_update_at;
static BOOL mock_node_off_target;
static BOOL mock_node_bounds_unavailable;
static BOOL mock_node_size_invalid;
static BOOL mock_multiple_failure;
static BOOL mock_multiple_attribute_error;
static BOOL mock_nested_web_area;
static BOOL mock_nested_image;
static CFIndex mock_branch_size;
static BOOL mock_deep_chain;
static AXUIElementRef mock_skipped_nodes[40];
static NSArray *mock_windows;
static BOOL mock_track_thread;
static BOOL mock_hit_on_main;
static BOOL mock_role_on_main;
static CFArrayRef mock_window_list(CGWindowListOption options, CGWindowID window) {
    return mock_windows ? (CFArrayRef)CFRetain((__bridge CFArrayRef)mock_windows) : NULL;
}
static Boolean mock_trusted(void) { return true; }
static AXUIElementRef mock_system(void) { return (AXUIElementRef)CFRetain(CFSTR("system")); }
static AXError mock_timeout(AXUIElementRef element, float timeout) { return kAXErrorSuccess; }
static AXError mock_element_pid(AXUIElementRef element, pid_t *pid) {
    *pid = 7199;
    return kAXErrorSuccess;
}
static AXError mock_set_attribute(AXUIElementRef element, CFStringRef attribute, CFTypeRef value) {
    if (CFEqual(attribute, CFSTR("AXEnhancedUserInterface")) && value == kCFBooleanTrue) {
        mock_accessibility_requests++;
    }
    if (CFEqual(attribute, CFSTR("AXManualAccessibility")) && value == kCFBooleanTrue) {
        mock_manual_accessibility_requests++;
    }
    return kAXErrorSuccess;
}
static AXError mock_hit(AXUIElementRef system, float x, float y, AXUIElementRef *element) {
    if (mock_track_thread) mock_hit_on_main = pthread_main_np();
    mock_hit_calls++;
    if (mock_retry_updates_hit && mock_hit_calls == (mock_retry_update_at ?: 2)) {
        mock_boundary_role = CFSTR("AXStaticText");
        mock_node_off_target = NO;
    }
    *element = mock_hit_selected_node ? (AXUIElementRef)CFRetain(mock_nodes[4])
        : mock_geometry_search ? (AXUIElementRef)CFRetain(mock_geometry_nodes[0])
        : mock_descendant_search ? (AXUIElementRef)CFRetain(mock_nodes[0])
        : mock_ancestor_search ? (AXUIElementRef)CFRetain(mock_nodes[4])
                               : (AXUIElementRef)CFRetain(CFSTR("element"));
    return kAXErrorSuccess;
}
static AXError mock_attribute(AXUIElementRef element, CFStringRef attribute, CFTypeRef *value) {
    if (mock_track_thread && CFEqual(attribute, kAXRoleAttribute)) mock_role_on_main = pthread_main_np();
    if (mock_observed_node && element == mock_observed_node) {
        if (CFEqual(attribute, kAXValueAttribute)) {
            mock_observed_value_reads++;
            if (mock_direct_text) {
                *value = CFBridgingRetain(mock_direct_text); return kAXErrorSuccess;
            }
        }
        if (CFEqual(attribute, kAXTitleAttribute)) mock_observed_title_reads++;
    }
    if (mock_inline_context) {
        if (element == mock_nodes[4] && CFEqual(attribute, kAXValueAttribute)) {
            *value = CFBridgingRetain(mock_inline_value); return kAXErrorSuccess;
        }
        if (element == mock_nodes[3] && CFEqual(attribute, kAXChildrenAttribute)) {
            const void *children[] = {mock_sibling, mock_nodes[4]};
            *value = CFArrayCreate(NULL, children, 2, &kCFTypeArrayCallBacks);
            return kAXErrorSuccess;
        }
        if (element == mock_sibling && CFEqual(attribute, kAXValueAttribute)) {
            *value = CFRetain(CFSTR("prefix ")); return kAXErrorSuccess;
        }
    }
    if ((mock_descendant_search || mock_ancestor_search) && CFEqual(attribute, kAXParentAttribute)) mock_parent_reads++;
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
                CGPoint position = CGPointMake(mock_many_containing ? 60 : 300, 0);
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
                    if (mock_empty_group_bounds_case == 3) return kAXErrorNoValue;
                    if (CFEqual(attribute, kAXPositionAttribute) && mock_empty_group_bounds_case) {
                        CGPoint position = CGPointMake(300, 0);
                        *value = AXValueCreate(kAXValueCGPointType, &position); return kAXErrorSuccess;
                    }
                    if (CFEqual(attribute, kAXSizeAttribute) && mock_empty_group_bounds_case == 2) {
                        CGSize size = CGSizeMake(200, 1);
                        *value = AXValueCreate(kAXValueCGSizeType, &size); return kAXErrorSuccess;
                    }
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
                : mock_descendant_search && i == 1 && mock_nested_image ? CFSTR("AXImage")
                : mock_descendant_search && i == 2 ? CFSTR("AXHeading")
                : mock_ancestor_web_area && i == 1 ? CFSTR("AXWebArea")
                : mock_ancestor_image && i == 3 ? CFSTR("AXImage")
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
            CFIndex count = i == 2 && mock_ancestor_search ? 2 : 1;
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
static AXError mock_multiple_attributes(AXUIElementRef element, CFArrayRef attributes,
                                        AXCopyMultipleAttributeOptions options, CFArrayRef *values) {
    if (mock_multiple_failure) return kAXErrorCannotComplete;
    CFMutableArrayRef result = CFArrayCreateMutable(NULL, 0, &kCFTypeArrayCallBacks);
    for (CFIndex i = 0; i < CFArrayGetCount(attributes); i++) {
        CFTypeRef value = NULL;
        AXError error = mock_attribute(element, CFArrayGetValueAtIndex(attributes, i), &value);
        if (mock_multiple_attribute_error && i == 1) {
            if (value) CFRelease(value);
            error = kAXErrorAttributeUnsupported;
            value = AXValueCreate(kAXValueAXErrorType, &error);
        }
        CFArrayAppendValue(result, value ?: kCFNull);
        if (value) CFRelease(value);
    }
    *values = result;
    return kAXErrorSuccess;
}
static AXError mock_parameterized(AXUIElementRef element, CFStringRef attribute, CFTypeRef parameter, CFTypeRef *value) {
    if (CFEqual(attribute, kAXRangeForPositionParameterizedAttribute)) {
        mock_position_calls++;
        if (mock_observed_node && element == mock_observed_node) mock_observed_position_calls++;
        if (mock_direct_text) {
            if (element != mock_observed_node) return kAXErrorParameterizedAttributeUnsupported;
            CFRange range = CFRangeMake(mock_direct_offset, 1);
            *value = AXValueCreate(kAXValueCFRangeType, &range); return kAXErrorSuccess;
        }
        if (mock_ancestor_empty_group && element == mock_nodes[3]) mock_empty_group_position_calls++;
        if (mock_position_error != kAXErrorSuccess) return mock_position_error;
        CFRange range = CFRangeMake(6, mock_empty_range ? 0 : 1);
        *value = AXValueCreate(kAXValueCFRangeType, &range); return kAXErrorSuccess;
    }
    if (CFEqual(attribute, kAXBoundsForRangeParameterizedAttribute)) {
        mock_bounds_calls++;
        if (mock_bounds_error) return mock_bounds_error;
        if (mock_invalid_bounds) {
            *value = CFRetain(CFSTR("not a rectangle")); return kAXErrorSuccess;
        }
        if (mock_observed_node && element == mock_observed_node) {
            mock_observed_bounds_calls++;
            if (mock_direct_text) {
                CFRange range; AXValueGetValue((AXValueRef)parameter, kAXValueCFRangeType, &range);
                CGRect rect = CGRectMake(60 + (range.location - mock_direct_offset) * 10, 0, range.length * 10, 20);
                *value = AXValueCreate(kAXValueCGRectType, &rect); return kAXErrorSuccess;
            }
        }
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
#define AXUIElementGetPid mock_element_pid
#define AXUIElementSetAttributeValue mock_set_attribute
#define AXUIElementCopyElementAtPosition mock_hit
#define AXUIElementCopyAttributeValue mock_attribute
#define AXUIElementCopyMultipleAttributeValues mock_multiple_attributes
#define AXUIElementCopyParameterizedAttributeValue mock_parameterized
#define CGWindowListCopyWindowInfo mock_window_list
#import "../../../../native/accessibility/macos/src/accessibility.m"
static NSDictionary *run(AXError error, BOOL empty, BOOL context) {
    mock_position_error = error; mock_empty_range = empty; mock_bounds_calls = 0;
    uint8_t *bytes = NULL; size_t length = 0;
    NSCAssert(dictol_read_mac_accessible_text(65, 10, context, &bytes, &length), @"lookup failed");
    NSData *data = [NSData dataWithBytes:bytes length:length]; free(bytes);
    return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}
static NSDictionary *find_descendant(AXUIElementRef element, CGPoint point,
                                      CFMutableSetRef visited, CFMutableSetRef nodes,
                                      NSString **stop_reason) {
    DictolTextMatch *match = text_in_descendants(element, point, visited, nodes, stop_reason);
    return match ? finish_text_match(match, NO) : nil;
}
static NSDictionary *run_geometry_search(void) {
    mock_position_error = kAXErrorParameterizedAttributeUnsupported;
    CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    NSString *stop_reason = nil;
    NSDictionary *result = find_descendant(mock_geometry_nodes[0],
                                                          CGPointMake(65, 10),
                                                          visited, NULL, &stop_reason);
    CFRelease(visited);
    return @{@"result": result ?: NSNull.null};
}
int main(void) { @autoreleasepool {
    for (NSString *sample in @[@"state-of-the-art can't _word_", @"中文，日文。", @"cafe\u0301 🌱 hello!"]) {
        NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitWord];
        tokenizer.string = sample;
        [tokenizer enumerateTokensInRange:NSMakeRange(0, sample.length)
                              usingBlock:^(NSRange token, NLTokenizerAttributes flags, BOOL *stop) {
            NSCAssert(NSEqualRanges(expanded_word_range(sample, token), word_range(sample, token.location)),
                      @"enumerated token must match position lookup in %@", sample);
        }];
    }
    CGRect element_rect = element_bounds((AXUIElementRef)CFSTR("element"));
    NSCAssert(CGRectEqualToRect(element_rect, CGRectMake(0, 0, 200, 100)), @"batch bounds failed");
    mock_multiple_failure = YES;
    NSCAssert(CGRectIsNull(element_bounds((AXUIElementRef)CFSTR("element"))), @"batch failure must return null");
    mock_multiple_failure = NO;
    mock_multiple_attribute_error = YES;
    NSCAssert(CGRectIsNull(element_bounds((AXUIElementRef)CFSTR("element"))), @"attribute error must return null");
    mock_multiple_attribute_error = NO;
    mock_node_bounds_unavailable = YES;
    NSCAssert(CGRectIsNull(element_bounds((AXUIElementRef)CFSTR("element"))), @"missing attribute must return null");
    mock_node_bounds_unavailable = NO;
    NSDictionary *window_bounds = CFBridgingRelease(CGRectCreateDictionaryRepresentation(CGRectMake(0, 0, 100, 100)));
    NSDictionary *own = @{(__bridge NSString *)kCGWindowOwnerPID: @(getpid()),
                          (__bridge NSString *)kCGWindowBounds: window_bounds};
    NSDictionary *other = @{(__bridge NSString *)kCGWindowOwnerPID: @(getpid() + 1),
                            (__bridge NSString *)kCGWindowBounds: window_bounds};
    NSDictionary *outside = @{
        (__bridge NSString *)kCGWindowOwnerPID: @(getpid() + 1),
        (__bridge NSString *)kCGWindowBounds:
            CFBridgingRelease(CGRectCreateDictionaryRepresentation(CGRectMake(200, 200, 100, 100)))
    };
    mock_windows = @[other, own];
    NSCAssert(point_is_inside_own_window(50, 50), @"a front window must not hide our window from the thread check");
    mock_windows = @[own, other];
    NSCAssert(point_is_inside_own_window(50, 50), @"our front window should be detected");
    mock_windows = @[other];
    NSCAssert(!point_is_inside_own_window(50, 50), @"an external window alone should stay on the worker");
    mock_windows = @[outside, own];
    NSCAssert(point_is_inside_own_window(50, 50), @"non-containing windows should be skipped");
    NSCAssert(!point_is_inside_own_window(150, 150), @"a point outside all windows should miss");
    mock_windows = nil;
    NSCAssert(point_is_inside_own_window(50, 50), @"an unavailable window list must use the main thread");
    for (NSNumber *scenario in @[@0, @1, @2]) {
        mock_windows = scenario.intValue == 0 ? @[other] : scenario.intValue == 1 ? @[other, own] : nil;
        mock_track_thread = YES;
        mock_hit_on_main = mock_role_on_main = NO;
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block NSDictionary *lookup = nil;
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
            lookup = run(kAXErrorSuccess, NO, YES);
            dispatch_semaphore_signal(done);
        });
        while (dispatch_semaphore_wait(done, DISPATCH_TIME_NOW) != 0) {
            [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        }
        BOOL expect_main = scenario.intValue != 0;
        NSCAssert([lookup[@"result"][@"word"] isEqualToString:@"world"] &&
                  mock_hit_on_main == expect_main && mock_role_on_main == expect_main,
                  @"window detection must dispatch the entire lookup to the correct thread");
        mock_track_thread = NO;
    }
    mock_windows = nil;
    mock_observed_node = (AXUIElementRef)CFSTR("element");
    // A complete normal token needs one word rectangle and its two endpoint
    // rectangles, plus the preceding off-target token: no duplicate word query.
    for (NSNumber *context in @[@NO, @YES]) {
        mock_observed_value_reads = mock_observed_title_reads = mock_observed_position_calls = 0;
        NSDictionary *cached = run(kAXErrorParameterizedAttributeUnsupported, NO, context.boolValue);
        NSCAssert([cached[@"result"][@"word"] isEqualToString:@"world"] &&
                  mock_observed_value_reads == 1 && mock_observed_title_reads == 0 &&
                  mock_observed_position_calls == 1 && mock_bounds_calls == 4,
                  @"fallback must reuse the candidate value and token rectangle");
    }
    mock_observed_value_reads = mock_observed_title_reads = mock_observed_position_calls = 0;
    NSDictionary *direct = run(kAXErrorSuccess, NO, YES);
    NSCAssert([direct[@"result"][@"text"] isEqualToString:@"hello world"] &&
              mock_observed_value_reads == 1 && mock_observed_title_reads == 0 &&
              mock_observed_position_calls == 1 && mock_bounds_calls == 3,
              @"direct hit and context must reuse the same node value");
    mock_direct_text = @"a b";
    mock_direct_offset = 1;
    NSDictionary *blank = run(kAXErrorSuccess, NO, NO);
    NSCAssert(blank[@"result"] == NSNull.null &&
              [blank[@"failure"] isEqualToString:@"no-word-at-point"] && mock_bounds_calls == 1,
              @"verified whitespace must stop before token scanning");
    mock_bounds_error = kAXErrorCannotComplete;
    NSDictionary *unverified_blank = run(kAXErrorSuccess, NO, NO);
    NSCAssert(![unverified_blank[@"failure"] isEqualToString:@"no-word-at-point"],
              @"whitespace without character bounds must remain inconclusive");
    mock_bounds_error = kAXErrorSuccess;
    mock_direct_text = nil;
    // The shared bounds helper must preserve direct-path failure details.
    AXError position_error = kAXErrorSuccess;
    NSString *bounds_failure = nil;
    mock_bounds_error = kAXErrorCannotComplete;
    NSCAssert(!word_at_point(NULL, @"hello world", CGPointMake(65, 10), &position_error, &bounds_failure) &&
              [bounds_failure isEqualToString:@"bounds-for-range:-25204"], @"bounds error code was lost");
    mock_bounds_error = kAXErrorSuccess;
    mock_invalid_bounds = YES;
    NSCAssert(!word_at_point(NULL, @"hello world", CGPointMake(65, 10), &position_error, &bounds_failure) &&
              [bounds_failure isEqualToString:@"invalid-word-bounds"], @"invalid bounds reason was lost");
    mock_invalid_bounds = NO;
    mock_observed_node = NULL;
    NSDictionary *result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"], @"unsupported did not hit word");
    NSCAssert(result[@"result"][@"text"] == nil && mock_bounds_calls > 0, @"dictionary contract");
    result = run(kAXErrorParameterizedAttributeUnsupported, NO, YES);
    NSCAssert([result[@"result"][@"text"] isEqualToString:@"hello world"] && [result[@"result"][@"offset"] intValue] == 6, @"AI contract");
    result = run(kAXErrorSuccess, YES, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"], @"empty range regression");
    CGRect tolerance_bounds = CGRectMake(60, 0, 50, 20);
    NSCAssert(word_bounds_at_point(NULL, @"world", NSMakeRange(0, 5),
                                  CGPointMake(65, -5), &tolerance_bounds), @"word tolerance missed");
    NSCAssert(!word_bounds_at_point(NULL, @"world", NSMakeRange(0, 5),
                                   CGPointMake(65, -7), &tolerance_bounds), @"word tolerance too large");
    mock_position_error = kAXErrorParameterizedAttributeUnsupported;
    NSCAssert(NSEqualRanges(text_by_word_bounds(NULL, @"hello world", CGPointMake(65, -2.5)).word, NSMakeRange(6, 5)),
              @"token tolerance missed");
    NSCAssert(!text_by_word_bounds(NULL, @"hello world", CGPointMake(65, -3.5)), @"token tolerance too large");
    mock_newline = YES;
    for (NSNumber *error in @[@(kAXErrorSuccess), @(kAXErrorParameterizedAttributeUnsupported)]) {
        result = run((AXError)error.intValue, NO, YES);
        NSCAssert([result[@"result"][@"text"] isEqualToString:@"hello world"] &&
                  [result[@"result"][@"offset"] intValue] == 6 &&
                  [result[@"result"][@"word"] isEqualToString:@"world"],
                  @"static text newline normalization failed");
    }
    mock_newline = NO;
    mock_hit_calls = 0;
    result = run(kAXErrorCannotComplete, NO, NO);
    NSCAssert(result[@"result"] == NSNull.null && mock_bounds_calls == 0 && mock_hit_calls == 1,
              @"communication failure must not trigger word fallback or hit-test retry");
    mock_wrapped_word = YES;
    CGRect bounds = CGRectMake(1308, 516, 644, 43);
    mock_bounds_calls = 0;
    NSCAssert(!word_bounds_at_point(NULL, @"もる", NSMakeRange(0, 2),
                                   CGPointMake(1556, 552), &bounds), @"wrapped word matched empty space");
    NSCAssert(mock_bounds_calls == 2, @"wrapped word bounds were queried twice");
    bounds = CGRectMake(1308, 516, 644, 43);
    NSCAssert(word_bounds_at_point(NULL, @"もる", NSMakeRange(0, 2),
                                  CGPointMake(1940, 525), &bounds) &&
              CGRectEqualToRect(bounds, CGRectMake(1936, 516, 16, 19)), @"first line bounds failed");
    bounds = CGRectMake(1308, 516, 644, 43);
    NSCAssert(word_bounds_at_point(NULL, @"もる", NSMakeRange(0, 2),
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
    // A >8192-character descendant is still eligible for direct positioning.
    // The old descendant-only token scan rejected it outright.
    mock_observed_node = mock_geometry_nodes[4];
    mock_direct_offset = 9000;
    mock_direct_text = [[@"" stringByPaddingToLength:9000 withString:@"x " startingAtIndex:0]
                        stringByAppendingString:@"world tail"];
    mock_observed_value_reads = mock_observed_title_reads = mock_observed_position_calls = mock_observed_bounds_calls = 0;
    CFMutableSetRef long_visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    NSString *long_stop = nil;
    DictolTextMatch *long_match = text_in_descendants(mock_geometry_nodes[0], CGPointMake(65, 10),
                                                    long_visited, NULL, &long_stop);
    CFRelease(long_visited);
    NSCAssert(long_match.text.length == mock_direct_text.length && long_match.offset == 9000,
              @"direct positioning should tokenize the existing AXValue without truncation");
    NSDictionary *long_context = finish_text_match(long_match, YES);
    NSCAssert([long_context[@"word"] isEqualToString:@"world"] &&
              [long_context[@"offset"] intValue] == 4096 && [long_context[@"text"] length] <= 8192 &&
              [long_context[@"x"] intValue] == 60 && [long_context[@"width"] intValue] == 50 &&
              mock_observed_position_calls == 1 && mock_observed_value_reads == 1 &&
              mock_observed_title_reads == 0 && mock_observed_bounds_calls == 3,
              @"long descendant must use direct positioning and unified context without scanning tokens");
    mock_direct_text = @"a b";
    mock_direct_offset = 1;
    CFMutableSetRef blank_visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    NSString *blank_stop = nil;
    DictolTextMatch *blank_match = text_in_descendants(mock_geometry_nodes[0], CGPointMake(65, 10),
                                                       blank_visited, NULL, &blank_stop);
    CFRelease(blank_visited);
    NSCAssert(!blank_match && [blank_stop isEqualToString:@"no-word-at-point"],
              @"verified whitespace in a descendant should stop the search");
    mock_direct_text = nil;
    mock_observed_node = NULL;
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
              mock_empty_group_geometry_reads > 0 && mock_geometry_children_reads[3] > 0 &&
              mock_geometry_bounds_calls[5] > 0, @"empty container subtree not searched");
    for (int bounds_case = 1; bounds_case <= 3; bounds_case++) {
        mock_empty_group_bounds_case = bounds_case;
        mock_geometry_children_reads[3] = 0;
        result = run_geometry_search();
        NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"] &&
                  (mock_geometry_children_reads[3] > 0) == (bounds_case != 1),
                  @"empty container bounds filtering failed");
    }
    mock_empty_group_bounds_case = 0;
    mock_geometry_empty_group = NO;
    for (int i = 0; i < 40; i++) mock_skipped_nodes[i] = AXUIElementCreateApplication(4000 + i);
    mock_many_skipped = YES;
    mock_geometry_shallow_hit = YES;
    result = run_geometry_search();
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"],
              @"skipped nodes exhausted the search budget");
    for (int empty = 0; empty <= 1; empty++) {
        mock_many_searchable = empty;
        mock_many_containing = empty;
        CFMutableSetRef budget_nodes = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
        CFMutableSetRef budget_visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
        for (int i = 0; i < 459; i++) CFSetAddValue(budget_nodes, (__bridge CFTypeRef)@(i));
        NSString *budget_stop = nil;
        NSDictionary *budget_result = find_descendant(mock_geometry_nodes[0], CGPointMake(65, 10),
                                                       budget_visited, budget_nodes, &budget_stop);
        NSCAssert([budget_result[@"word"] isEqualToString:@"world"] && !budget_stop &&
                  CFSetGetCount(budget_nodes) == 500, @"all examined children must consume traversal budget");
        CFRelease(budget_visited);
        CFRelease(budget_nodes);
    }
    mock_many_searchable = YES;
    mock_many_containing = YES;
    mock_geometry_shallow_hit = NO;
    mock_many_expanded = 0;
    result = run_geometry_search();
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"] &&
              mock_many_expanded == 40 && mock_visible_reads == 0,
              @"search did not continue past 32 searchable nodes");
    mock_many_searchable = NO;
    mock_many_containing = NO;
    mock_many_skipped = NO;
    for (int i = 0; i < 40; i++) CFRelease(mock_skipped_nodes[i]);
    mock_geometry_search = NO;
    for (int i = 0; i < 7; i++) CFRelease(mock_geometry_nodes[i]);
    mock_sibling = AXUIElementCreateApplication(2000);
    mock_inline_context = YES;
    mock_inline_value = @"world world";
    // Both hover positioning routes expand context from the same retained node.
    for (NSNumber *error in @[@(kAXErrorSuccess), @(kAXErrorParameterizedAttributeUnsupported)]) {
        mock_position_error = error.intValue;
        mock_empty_range = NO;
        AXError hover_error = kAXErrorSuccess;
        NSString *hover_failure = nil;
        DictolTextMatch *hover_match = lookup_text_node(mock_nodes[4], @"AXStaticText", mock_inline_value,
                                                       CGPointMake(65, 10), &hover_error, &hover_failure);
        NSCAssert(hover_match != nil, @"hover did not find the inline word");
        NSDictionary *hover_context = finish_text_match(hover_match, YES);
        NSCAssert([hover_context[@"text"] isEqualToString:@"prefix world world"] &&
                  [hover_context[@"offset"] intValue] == 13 && [hover_context[@"x"] intValue] == 60,
                  @"direct and token hits must share inline expansion and preserve geometry");
    }
    mock_hit_selected_node = YES;
    mock_position_error = kAXErrorSuccess;
    CFMutableSetRef full_lookup_nodes = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    for (int i = 0; i < 500; i++) CFSetAddValue(full_lookup_nodes, (__bridge CFTypeRef)@(i));
    BOOL hover_retry = NO;
    NSDictionary *full_budget_hover = read_accessible_text_once(65, 10, YES, 0, &hover_retry,
                                                                full_lookup_nodes);
    NSCAssert(!hover_retry && CFSetGetCount(full_lookup_nodes) == 500 &&
              [full_budget_hover[@"result"][@"text"] isEqualToString:@"prefix world world"] &&
              [full_budget_hover[@"result"][@"offset"] intValue] == 13,
              @"inline expansion must not consume or depend on the lookup budget");
    CFRelease(full_lookup_nodes);
    mock_hit_selected_node = NO;
    mock_position_error = kAXErrorParameterizedAttributeUnsupported;
    mock_inline_context = NO;
    CFRelease(mock_sibling);
    mock_sibling = NULL;
    mock_newline = NO;
    CFMutableSetRef visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    NSString *stop_reason = nil;
    result = find_descendant(mock_nodes[0], CGPointMake(65, 10), visited, NULL, &stop_reason);
    NSCAssert([result[@"word"] isEqualToString:@"world"] && CFSetGetCount(visited) == 5, @"nested style lookup failed");
    NSCAssert(!find_descendant(mock_nodes[0], CGPointMake(65, 10), visited, NULL, &stop_reason), @"subtree was scanned twice");
    CFRelease(visited);
    visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    for (int i = 0; i < 32; i++) {
        NSNumber *item = @(i);
        CFSetAddValue(visited, (__bridge CFTypeRef)item);
    }
    result = find_descendant(mock_nodes[0], CGPointMake(65, 10), visited, NULL, &stop_reason);
    NSCAssert([result[@"word"] isEqualToString:@"world"] && !stop_reason,
              @"search limit was not disabled");
    CFRelease(visited);
    mock_descendant_search = YES;
    // The nested style fixture has five distinct nodes including the initial hit.
    mock_boundary_role = CFSTR("AXGroup");
    for (int existing = 496; existing <= 497; existing++) {
        CFMutableSetRef nodes = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
        for (int i = 0; i < existing; i++) CFSetAddValue(nodes, (__bridge CFTypeRef)@(i));
        mock_position_error = kAXErrorParameterizedAttributeUnsupported;
        mock_parent_reads = 0;
        BOOL retry = NO;
        result = read_accessible_text_once(65, 10, NO, 0, &retry, nodes);
        NSCAssert(result != nil, @"lookup did not complete");
        NSCAssert(CFSetGetCount(nodes) == 500 && !retry && mock_parent_reads == 0,
                  @"incorrect total traversal budget");
        if (existing == 496) {
            NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"], @"500th node should be usable");
        } else {
            NSCAssert(result[@"result"] == NSNull.null && [result[@"failure"] hasSuffix:@"node-limit:500"],
                      @"501st node should stop the lookup");
        }
        NSCAssert(admit_lookup_node(nodes, mock_nodes[1]), @"revisiting a subtree node costs no extra slot");
        CFRelease(nodes);
    }
    mock_deep_chain = YES;
    mock_parent_reads = 0;
    CFMutableSetRef depth_nodes = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    BOOL depth_retry = NO;
    result = read_accessible_text_once(65, 10, NO, 2, &depth_retry, depth_nodes);
    NSCAssert(mock_parent_reads == 2 && [result[@"failure"] hasSuffix:@"ancestor-depth-limit"] &&
              CFSetGetCount(depth_nodes) == 0, @"hit and ancestor nodes must not consume subtree budget");
    CFRelease(depth_nodes);
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
    for (NSString *role in @[@"AXWebArea", @"AXScrollArea", @"AXImage"]) {
        mock_hit_calls = 0;
        mock_accessibility_requests = 0;
        mock_manual_accessibility_requests = 0;
        mock_boundary_role = (__bridge CFStringRef)role;
        mock_node_off_target = [role isEqualToString:@"AXImage"];
        result = run(kAXErrorSuccess, NO, NO);
        NSCAssert(mock_hit_calls == 2 && [result[@"result"][@"word"] isEqualToString:@"world"],
                  @"retry after %@ did not use the updated hit", role);
        NSCAssert(mock_accessibility_requests == 0 && mock_manual_accessibility_requests == 0,
                  @"successful retry must not request application accessibility");
    }
    mock_retry_update_at = 3;
    mock_hit_calls = 0;
    mock_boundary_role = CFSTR("AXWebArea");
    result = run(kAXErrorSuccess, NO, NO);
    NSCAssert(mock_hit_calls == 3 && [result[@"result"][@"word"] isEqualToString:@"world"],
              @"second retry did not use the updated hit");
    mock_retry_update_at = 0;
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
        NSCAssert(mock_hit_calls == 3 && [result[@"failure"] isEqualToString:@"AXImage: image-content"],
                  @"image with unusable or off-target bounds should retry twice");
    }
    mock_node_bounds_unavailable = NO;
    mock_node_size_invalid = NO;
    mock_node_off_target = NO;
    mock_boundary_role = CFSTR("AXStaticText");
    for (NSNumber *unavailable in @[@NO, @YES]) {
        mock_node_bounds_unavailable = unavailable.boolValue;
        mock_hit_calls = 0;
        result = run(kAXErrorSuccess, YES, NO);
        NSCAssert(mock_hit_calls == (unavailable.boolValue ? 3 : 1) &&
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
    mock_nested_image = YES;
    mock_branch_size = 101;
    mock_observed_node = mock_nodes[1];
    mock_observed_value_reads = 0;
    visited = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    result = find_descendant(mock_nodes[0], CGPointMake(65, 10), visited, NULL, &stop_reason);
    NSCAssert([result[@"word"] isEqualToString:@"world"] && mock_observed_value_reads == 0,
              @"image branch must be skipped while searching its sibling");
    CFRelease(visited);
    mock_observed_node = NULL;
    mock_nested_image = NO;
    mock_branch_size = 0;
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
    mock_observed_node = mock_nodes[0];
    mock_observed_value_reads = mock_observed_title_reads = 0;
    CFMutableSetRef retry_nodes = CFSetCreateMutable(NULL, 0, &kCFTypeSetCallBacks);
    BOOL retry_pending = NO;
    NSDictionary *retry_result = read_accessible_text_once(65, 10, YES, 0, &retry_pending, retry_nodes);
    NSCAssert(retry_pending && retry_result == nil &&
              CFSetGetCount(retry_nodes) == 0 &&
              mock_observed_value_reads == 0 && mock_observed_title_reads == 0,
              @"retry must not read text or build a public response");
    retry_pending = NO;
    retry_result = read_accessible_text_once(65, 10, YES, 2, &retry_pending, retry_nodes);
    NSCAssert(!retry_pending && [retry_result[@"failure"] isEqualToString:@"AXWebArea: search-boundary"] &&
              CFSetGetCount(retry_nodes) == 0 &&
              mock_observed_value_reads == 0 && mock_observed_title_reads == 0,
              @"boundary exit must not read value or title");
    CFRelease(retry_nodes);
    mock_observed_node = NULL;
    for (NSNumber *context in @[@NO, @YES]) {
        mock_accessibility_requests = 0;
        mock_manual_accessibility_requests = 0;
        result = run(kAXErrorParameterizedAttributeUnsupported, NO, context.boolValue);
        NSCAssert(result[@"result"] == NSNull.null &&
                  [result[@"failure"] isEqualToString:@"AXWebArea: search-boundary"] &&
                  mock_root_children_reads == 0 && mock_parent_reads == 0 &&
                  mock_accessibility_requests == 1 && mock_manual_accessibility_requests == 1,
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
        mock_accessibility_requests = 0;
        mock_manual_accessibility_requests = 0;
        result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
        NSCAssert(result[@"result"] == NSNull.null && mock_bounds_calls == 0 &&
                  [result[@"failure"] isEqualToString:[role stringByAppendingString:@": search-boundary"]],
                  @"search did not stop at boundary");
        NSCAssert(mock_accessibility_requests == ([role isEqualToString:@"AXScrollArea"] ? 1 : 0) &&
                  mock_manual_accessibility_requests == ([role isEqualToString:@"AXScrollArea"] ? 1 : 0),
                  @"only persistent page containers should request accessibility");
        NSCAssert(mock_parent_reads == 0, @"searched beyond boundary");
    }
    mock_descendant_search = NO;
    mock_sibling = AXUIElementCreateApplication(2000);
    mock_ancestor_search = YES;
    mock_parent_reads = 0;
    mock_original_bounds_calls = 0;
    result = run(kAXErrorParameterizedAttributeUnsupported, NO, NO);
    NSCAssert([result[@"result"][@"word"] isEqualToString:@"world"] &&
              mock_parent_reads == 2 && mock_original_bounds_calls == 2,
              @"word lookup should find a sibling within two ancestors without rechecking the hit");
    CFRelease(mock_sibling);
    mock_ancestor_search = NO;
    for (int i = 0; i < 5; i++) CFRelease(mock_nodes[i]);
    CFRelease(mock_after_group);
    CFRelease(mock_after_word);
    NSLog(@"AX fallback integration scenarios passed");
} return 0; }
