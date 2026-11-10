use napi_derive::napi;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

/// 查询当前进程的屏幕录制权限；实际截图结果仍是最终判断依据。
#[napi]
pub fn has_screen_capture_permission() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}
