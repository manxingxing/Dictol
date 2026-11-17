use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use screencapturekit::cg::CGRect;
use screencapturekit::cm::{CMSampleBuffer, CMSampleBufferExt, CMSampleBufferSCExt};
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::{PixelFormat, SCStream, SCStreamOutputType};
use screencapturekit::prelude::{SCContentFilter, SCShareableContent, SCStreamConfiguration};
use screencapturekit::screenshot_manager::{CGImage, SCScreenshotManager};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

unsafe extern "C" {
    fn dictol_supports_capture_image_in_rect() -> bool;
    fn dictol_supports_screenshot_manager() -> bool;
    fn dictol_display_scale(display_id: u32) -> f64;
    fn dictol_encode_image_png(
        image: *mut std::ffi::c_void,
        output: *mut *mut u8,
        output_length: *mut usize,
    ) -> bool;
    fn dictol_free_image_png(bytes: *mut u8);
    fn dictol_image_from_rgba(
        pixels: *const u8,
        width: usize,
        height: usize,
    ) -> *mut std::ffi::c_void;
}

#[napi(object)]
pub struct ScreenCaptureImage {
    pub png: Buffer,
    pub width: u32,
    pub height: u32,
}

pub struct CaptureRegionTask {
    display_id: u32,
    rect: CGRect,
}

pub struct CaptureDisplayTask {
    display_id: u32,
}

pub struct CaptureWindowTask {
    window_id: u32,
}

impl Task for CaptureRegionTask {
    type Output = ScreenCaptureImage;
    type JsValue = ScreenCaptureImage;

    fn compute(&mut self) -> Result<Self::Output> {
        capture_region(self.display_id, self.rect)
            .map_err(|error| Error::new(Status::GenericFailure, error))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

impl Task for CaptureDisplayTask {
    type Output = ScreenCaptureImage;
    type JsValue = ScreenCaptureImage;

    fn compute(&mut self) -> Result<Self::Output> {
        capture_display_image(self.display_id)
            .map_err(|error| Error::new(Status::GenericFailure, error))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

impl Task for CaptureWindowTask {
    type Output = ScreenCaptureImage;
    type JsValue = ScreenCaptureImage;

    fn compute(&mut self) -> Result<Self::Output> {
        capture_window_image(self.window_id)
            .map_err(|error| Error::new(Status::GenericFailure, error))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// 截取指定显示器内的矩形；坐标和尺寸使用全局屏幕点坐标。
#[napi(ts_return_type = "Promise<ScreenCaptureImage>")]
pub fn capture_screen_region(
    display_id: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<AsyncTask<CaptureRegionTask>> {
    if ![x, y, width, height].iter().all(|value| value.is_finite()) || width <= 0.0 || height <= 0.0
    {
        return Err(Error::new(Status::InvalidArg, "Invalid screen region"));
    }
    Ok(AsyncTask::new(CaptureRegionTask {
        display_id: validate_id(display_id)?,
        rect: CGRect::new(x, y, width, height),
    }))
}

/// 根据 Core Graphics 显示器 ID 截取整个显示器。
#[napi(ts_return_type = "Promise<ScreenCaptureImage>")]
pub fn capture_display(display_id: f64) -> Result<AsyncTask<CaptureDisplayTask>> {
    Ok(AsyncTask::new(CaptureDisplayTask {
        display_id: validate_id(display_id)?,
    }))
}

/// 根据 Core Graphics 窗口 ID 截取独立窗口。
#[napi(ts_return_type = "Promise<ScreenCaptureImage>")]
pub fn capture_window(window_id: f64) -> Result<AsyncTask<CaptureWindowTask>> {
    Ok(AsyncTask::new(CaptureWindowTask {
        window_id: validate_id(window_id)?,
    }))
}

/// 在 Node 输入端验证 ID，避免浮点数转整数时截断或溢出。
pub(super) fn validate_id(id: f64) -> Result<u32> {
    if !id.is_finite() || id.fract() != 0.0 || id < 1.0 || id > f64::from(u32::MAX) {
        return Err(Error::new(
            Status::InvalidArg,
            "Invalid display or window ID",
        ));
    }
    Ok(id as u32)
}

/// 判断截图区域是否完全位于显示器范围内，边界重合也视为包含。
fn contains_rect(outer: CGRect, inner: CGRect) -> bool {
    inner.origin.x >= outer.origin.x
        && inner.origin.y >= outer.origin.y
        && inner.origin.x + inner.size.width <= outer.origin.x + outer.size.width
        && inner.origin.y + inner.size.height <= outer.origin.y + outer.size.height
}

/// 计算两个矩形的重叠面积，用于为跨屏窗口选择主要显示器。
pub(super) fn overlap_area(a: CGRect, b: CGRect) -> f64 {
    let width = ((a.origin.x + a.size.width).min(b.origin.x + b.size.width)
        - a.origin.x.max(b.origin.x))
    .max(0.0);
    let height = ((a.origin.y + a.size.height).min(b.origin.y + b.size.height)
        - a.origin.y.max(b.origin.y))
    .max(0.0);
    width * height
}

/// 截取指定显示器内的区域；macOS 15.2 及以上使用矩形截图接口。
fn capture_region(
    display_id: u32,
    rect: CGRect,
) -> std::result::Result<ScreenCaptureImage, String> {
    image_to_png(capture_region_image(display_id, rect)?)
}

pub(super) fn capture_region_image(
    display_id: u32,
    rect: CGRect,
) -> std::result::Result<CGImage, String> {
    let content = SCShareableContent::get().map_err(|error| error.to_string())?;
    let displays = content.displays();
    let display = displays
        .iter()
        .find(|display| display.display_id() == display_id)
        .ok_or_else(|| format!("ScreenCaptureKit display {display_id} was not found"))?;
    let frame = display.frame();
    if !contains_rect(frame, rect) {
        return Err("Screen region must be contained in the specified display".to_owned());
    }
    if unsafe { dictol_supports_capture_image_in_rect() } {
        let image =
            SCScreenshotManager::capture_image_in_rect(rect).map_err(|error| error.to_string())?;
        return Ok(image);
    }
    let filter = SCContentFilter::create()
        .with_display(display)
        .with_excluding_windows(&[])
        .build()
        .map_err(|error| error.to_string())?;
    let (scale_x, scale_y) = display_scale(display)?;
    // 旧接口的源矩形以显示器左上角为原点，而输入使用全局屏幕坐标。
    let configuration = SCStreamConfiguration::new()
        .with_source_rect(CGRect::new(
            rect.origin.x - frame.origin.x,
            rect.origin.y - frame.origin.y,
            rect.size.width,
            rect.size.height,
        ))
        .with_width(pixel_dimension(rect.size.width, scale_x)?)
        .with_height(pixel_dimension(rect.size.height, scale_y)?)
        .with_shows_cursor(false);
    capture_filtered_image(&filter, configuration)
}

/// 截取指定显示器的完整画面。
fn capture_display_image(display_id: u32) -> std::result::Result<ScreenCaptureImage, String> {
    let content = SCShareableContent::get().map_err(|error| error.to_string())?;
    let displays = content.displays();
    let display = displays
        .iter()
        .find(|display| display.display_id() == display_id)
        .ok_or_else(|| format!("ScreenCaptureKit display {display_id} was not found"))?;
    let filter = SCContentFilter::create()
        .with_display(display)
        .with_excluding_windows(&[])
        .build()
        .map_err(|error| error.to_string())?;
    let (scale_x, scale_y) = display_scale(display)?;
    let frame = display.frame();
    let configuration = SCStreamConfiguration::new()
        .with_width(pixel_dimension(frame.size.width, scale_x)?)
        .with_height(pixel_dimension(frame.size.height, scale_y)?)
        .with_shows_cursor(false);
    capture_filtered(&filter, configuration)
}

/// 使用独立窗口过滤器截取指定窗口。
fn capture_window_image(window_id: u32) -> std::result::Result<ScreenCaptureImage, String> {
    let content = SCShareableContent::get().map_err(|error| error.to_string())?;
    let displays = content.displays();
    let window = content
        .windows()
        .into_iter()
        .find(|window| window.window_id() == window_id)
        .ok_or_else(|| format!("ScreenCaptureKit window {window_id} was not found"))?;
    let frame = window.frame();
    // 窗口跨越多个显示器时，按重叠面积最大的显示器选择像素比例。
    let display = displays
        .iter()
        .filter(|display| overlap_area(display.frame(), frame) > 0.0)
        .max_by(|a, b| overlap_area(a.frame(), frame).total_cmp(&overlap_area(b.frame(), frame)))
        .ok_or_else(|| format!("ScreenCaptureKit window {window_id} is not on a display"))?;
    let filter = SCContentFilter::create()
        .with_window(&window)
        .build()
        .map_err(|error| error.to_string())?;
    let (scale_x, scale_y) = display_scale(display)?;
    let configuration = SCStreamConfiguration::new()
        .with_width(pixel_dimension(frame.size.width, scale_x)?)
        .with_height(pixel_dimension(frame.size.height, scale_y)?)
        .with_shows_cursor(false);
    capture_filtered(&filter, configuration)
}

/// 获取显示器当前模式的点到像素比例，供截图配置设置输出尺寸。
fn display_scale(
    display: &screencapturekit::shareable_content::SCDisplay,
) -> std::result::Result<(f64, f64), String> {
    let scale = unsafe { dictol_display_scale(display.display_id()) };
    if !scale.is_finite() || scale <= 0.0 {
        return Err("Could not determine display pixel scale".to_owned());
    }
    Ok((scale, scale))
}

/// 将点数转换为四舍五入的像素数，并拒绝无法表示的输出尺寸。
fn pixel_dimension(points: f64, scale: f64) -> std::result::Result<u32, String> {
    let pixels = (points * scale).round();
    if !pixels.is_finite() || pixels < 1.0 || pixels > f64::from(u32::MAX) {
        return Err("Capture dimensions are invalid".to_owned());
    }
    Ok(pixels as u32)
}

/// macOS 14 及以上使用单帧截图接口，macOS 13 使用流式回退。
fn capture_filtered(
    filter: &SCContentFilter,
    configuration: SCStreamConfiguration,
) -> std::result::Result<ScreenCaptureImage, String> {
    image_to_png(capture_filtered_image(filter, configuration)?)
}

fn capture_filtered_image(
    filter: &SCContentFilter,
    configuration: SCStreamConfiguration,
) -> std::result::Result<CGImage, String> {
    if unsafe { dictol_supports_screenshot_manager() } {
        let image = SCScreenshotManager::capture_image(filter, &configuration)
            .map_err(|error| error.to_string())?;
        Ok(image)
    } else {
        capture_stream_frame(filter, &configuration.with_pixel_format(PixelFormat::BGRA))
    }
}

/// 启动截图流，等待首个完整帧并停止；超时或捕获失败时返回错误。
#[cfg(target_os = "macos")]
fn capture_stream_frame(
    filter: &SCContentFilter,
    configuration: &SCStreamConfiguration,
) -> std::result::Result<CGImage, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let captured = AtomicBool::new(false);
    let mut stream = SCStream::new(filter, configuration).map_err(|error| error.to_string())?;
    stream
        .add_output_handler(
            move |sample: CMSampleBuffer, _: SCStreamOutputType| {
                if sample
                    .frame_status()
                    .is_some_and(|status| !status.is_complete())
                {
                    return;
                }
                if let Some(buffer) = sample.pixel_buffer() {
                    if captured.swap(true, Ordering::Relaxed) {
                        return;
                    }
                    let result = (|| {
                        let guard = buffer
                            .lock(CVPixelBufferLockFlags::READ_ONLY)
                            .map_err(|error| format!("Could not lock captured frame: {error:?}"))?;
                        let data = unsafe { guard.as_slice() }
                            .ok_or_else(|| "Captured frame has no pixel data".to_owned())?;
                        let width = buffer.width();
                        let height = buffer.height();
                        let stride = guard.bytes_per_row();
                        if stride < width * 4 || data.len() < stride * height {
                            return Err("Captured frame has invalid pixel dimensions".to_owned());
                        }
                        // 输入为可能带行填充的 BGRA，编码前转换为紧凑的 RGBA。
                        let mut rgba = Vec::with_capacity(width * height * 4);
                        for row in data.chunks_exact(stride).take(height) {
                            for pixel in row[..width * 4].chunks_exact(4) {
                                rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
                            }
                        }
                        let image = unsafe { dictol_image_from_rgba(rgba.as_ptr(), width, height) };
                        if image.is_null() {
                            return Err("Could not create captured image".to_owned());
                        }
                        Ok(unsafe { CGImage::from_raw(image) })
                    })();
                    let _ = sender.try_send(result);
                }
            },
            SCStreamOutputType::Screen,
        )
        .map_err(|error| error.to_string())?;
    stream.start_capture().map_err(|error| error.to_string())?;
    let result = receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Could not receive captured frame: {error}"));
    let stop = stream.stop_capture().map_err(|error| error.to_string());
    let image = result??;
    stop?;
    Ok(image)
}

/// 将截图接口返回的 CGImage 转换为 PNG 和像素尺寸。
#[cfg(target_os = "macos")]
fn image_to_png(
    image: screencapturekit::screenshot_manager::CGImage,
) -> std::result::Result<ScreenCaptureImage, String> {
    let width = image.width() as u32;
    let height = image.height() as u32;
    let mut output = std::ptr::null_mut();
    let mut length = 0;
    if !unsafe { dictol_encode_image_png(image.as_ptr(), &mut output, &mut length) } {
        return Err("Could not encode captured image as PNG".to_owned());
    }
    let png = unsafe { std::slice::from_raw_parts(output, length).to_vec() };
    unsafe { dictol_free_image_png(output) };
    Ok(ScreenCaptureImage {
        png: png.into(),
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::{contains_rect, image_to_png, overlap_area, pixel_dimension};
    use screencapturekit::cg::CGRect;

    #[test]
    fn display_geometry_handles_negative_origins_and_partial_overlap() {
        let display = CGRect::new(-1920.0, -200.0, 1920.0, 1080.0);
        assert!(contains_rect(
            display,
            CGRect::new(-1920.0, -200.0, 100.0, 100.0)
        ));
        assert!(!contains_rect(display, CGRect::new(-10.0, 0.0, 20.0, 20.0)));
        assert_eq!(
            overlap_area(display, CGRect::new(-10.0, 0.0, 20.0, 20.0)),
            200.0
        );
        assert_eq!(
            overlap_area(display, CGRect::new(0.0, 0.0, 20.0, 20.0)),
            0.0
        );
        assert_eq!(pixel_dimension(100.5, 2.0).unwrap(), 201);
        assert!(pixel_dimension(0.0, 2.0).is_err());
    }

    #[test]
    fn png_preserves_transparent_window_color() {
        use screencapturekit::screenshot_manager::CGImage;
        let pixels = [64, 32, 0, 128];
        let image = unsafe { super::dictol_image_from_rgba(pixels.as_ptr(), 1, 1) };
        assert!(!image.is_null());
        let image = unsafe { CGImage::from_raw(image) };
        let output = image_to_png(image).unwrap();
        let decoder = png::Decoder::new(std::io::Cursor::new(output.png.as_ref()));
        let mut reader = decoder.read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut pixels).unwrap();
        assert_eq!(pixels, [128, 64, 0, 128]);
    }

    #[test]
    fn stream_image_owns_its_pixels() {
        use screencapturekit::screenshot_manager::{CGImage, CGImageExt};
        let pixels = vec![255, 0, 0, 255, 0, 0, 255, 255];
        let image = unsafe { super::dictol_image_from_rgba(pixels.as_ptr(), 1, 2) };
        assert!(!image.is_null());
        let image = unsafe { CGImage::from_raw(image) };
        drop(pixels);
        assert_eq!(image.rgba_data().unwrap(), [255, 0, 0, 255, 0, 0, 255, 255]);
    }
}
