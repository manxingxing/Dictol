#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

#ifdef __cplusplus
extern "C" {
#endif

// 同步截图接口，仅由 Node 工作线程调用；error 必须指向有效的 NSError * 变量。
// 列表只是调用时的目标快照。显示器和窗口分别枚举、组装返回结果。
NSArray *list_displays(NSError **error);
NSArray *list_windows(NSError **error);
// 以下接口成功时均返回自持有图像（尺寸为像素），调用方须 CGImageRelease。
// 区域使用全局屏幕点坐标，必须完全位于指定显示器内。
CGImageRef capture_region(uint32_t display_id, CGRect region,
                                NSError **error) CF_RETURNS_RETAINED;
// 截取指定显示器的完整边界。
CGImageRef capture_display(uint32_t display_id, NSError **error) CF_RETURNS_RETAINED;
// 使用独立窗口过滤器截图；跨屏时按最大重叠显示器确定像素比例。
CGImageRef capture_window(uint32_t window_id, NSError **error) CF_RETURNS_RETAINED;

#ifdef __cplusplus
}
#endif
