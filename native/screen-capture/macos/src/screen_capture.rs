use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use screencapturekit::cg::CGRect;
use screencapturekit::prelude::{SCContentFilter, SCShareableContent, SCStreamConfiguration};
use screencapturekit::screenshot_manager::{CGImageExt, SCScreenshotManager};

unsafe extern "C" {
    fn dictol_supports_capture_image_in_rect() -> bool;
}

#[napi(object)]
pub struct ScreenCaptureImage {
    pub png: Buffer,
    pub width: u32,
    pub height: u32,
}

pub struct CaptureScreenRegionTask {
    display_id: u32,
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
            let capture = capture_region(self.display_id, self.x, self.y, self.width, self.height)
                .map_err(|error| Error::new(Status::GenericFailure, error))?;
            Ok(capture)
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
    display_id: u32,
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
        display_id,
        x,
        y,
        width,
        height,
    }))
}

#[cfg(target_os = "macos")]
fn capture_region(
    display_id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> std::result::Result<ScreenCaptureImage, String> {
    let rect = CGRect::new(x, y, width, height);
    let image = if unsafe { dictol_supports_capture_image_in_rect() } {
        SCScreenshotManager::capture_image_in_rect(rect).map_err(|error| error.to_string())?
    } else {
        capture_region_with_filter(display_id, x, y, width, height)?
    };
    image_to_png(image)
}

#[cfg(target_os = "macos")]
fn capture_region_with_filter(
    display_id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> std::result::Result<screencapturekit::screenshot_manager::CGImage, String> {
    let content = SCShareableContent::get().map_err(|error| error.to_string())?;
    let display = content
        .displays()
        .into_iter()
        .find(|display| display.display_id() == display_id)
        .ok_or_else(|| format!("ScreenCaptureKit display {display_id} was not found"))?;
    let frame = display.frame();
    let scale_x = f64::from(display.width()) / frame.size.width;
    let scale_y = f64::from(display.height()) / frame.size.height;
    if !scale_x.is_finite() || !scale_y.is_finite() || scale_x <= 0.0 || scale_y <= 0.0 {
        return Err("ScreenCaptureKit returned invalid display dimensions".to_owned());
    }

    let source_rect = CGRect::new(x - frame.origin.x, y - frame.origin.y, width, height);
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build()
        .map_err(|error| error.to_string())?;
    let configuration = SCStreamConfiguration::new()
        .with_source_rect(source_rect)
        .with_width((width * scale_x).round() as u32)
        .with_height((height * scale_y).round() as u32);
    SCScreenshotManager::capture_image(&filter, &configuration).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn image_to_png(
    image: screencapturekit::screenshot_manager::CGImage,
) -> std::result::Result<ScreenCaptureImage, String> {
    let width = image.width();
    let height = image.height();
    let pixels = image.rgba_data().map_err(|error| error.to_string())?;
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer
            .write_image_data(&pixels)
            .map_err(|error| error.to_string())?;
    }
    Ok(ScreenCaptureImage {
        png: png.into(),
        width: width as u32,
        height: height as u32,
    })
}
