use napi_derive::napi;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

#[napi]
pub fn has_screen_capture_permission() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}
