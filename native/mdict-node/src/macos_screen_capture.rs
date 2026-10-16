use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

#[napi(object)]
pub struct ScreenCaptureImage {
    pub png: Buffer,
    pub width: u32,
    pub height: u32,
}

pub struct CaptureScreenRegionTask {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Task for CaptureScreenRegionTask {
    type Output = ScreenCaptureImage;
    type JsValue = ScreenCaptureImage;

    fn compute(&mut self) -> Result<Self::Output> {
        #[cfg(target_os = "macos")]
        {
            use std::ptr;

            unsafe extern "C" {
                fn dictol_capture_screen_region(
                    x: f64,
                    y: f64,
                    width: f64,
                    height: f64,
                    bytes: *mut *mut u8,
                    length: *mut usize,
                    image_width: *mut usize,
                    image_height: *mut usize,
                ) -> i32;
                fn dictol_free_screen_region(bytes: *mut u8);
            }

            let mut bytes = ptr::null_mut();
            let mut length = 0;
            let mut width = 0;
            let mut height = 0;
            // The Objective-C bridge owns the malloc buffer. Copy it into a
            // N-API Buffer before releasing that native allocation.
            let status = unsafe {
                dictol_capture_screen_region(
                    self.x,
                    self.y,
                    self.width,
                    self.height,
                    &mut bytes,
                    &mut length,
                    &mut width,
                    &mut height,
                )
            };
            if status != 1 || bytes.is_null() {
                return Err(Error::new(
                    Status::GenericFailure,
                    "macOS could not capture the screen region",
                ));
            }
            let png = unsafe { std::slice::from_raw_parts(bytes, length).to_vec() };
            unsafe { dictol_free_screen_region(bytes) };
            Ok(ScreenCaptureImage {
                png: png.into(),
                width: width as u32,
                height: height as u32,
            })
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err(Error::new(
                Status::GenericFailure,
                "Screen region capture requires macOS",
            ))
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<ScreenCaptureImage>")]
pub fn capture_screen_region(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<AsyncTask<CaptureScreenRegionTask>> {
    if ![x, y, width, height].iter().all(|value| value.is_finite()) || width <= 0.0 || height <= 0.0
    {
        return Err(Error::new(Status::InvalidArg, "Invalid screen region"));
    }
    Ok(AsyncTask::new(CaptureScreenRegionTask {
        x,
        y,
        width,
        height,
    }))
}
