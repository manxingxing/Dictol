//! 普通悬停查词的原生截图与识别编排。图像不编码为 PNG，也不向 JS 暴露像素。
use std::sync::Arc;

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

use crate::ocr::{WindowsOcrResult, recognize_frame};
use crate::windows_screen_capture::{
    CaptureEngine, RawFrame, capture_region_image, normalize_id, parse_capture_engine,
    region_coordinate, region_size,
};

fn capture_frame(
    display_id: &str,
    region: (i32, i32, u32, u32),
    engine: CaptureEngine,
) -> Result<RawFrame> {
    let (x, y, width, height) = region;
    capture_region_image(display_id, x, y, width, height, engine)
}

fn recognize(frame: &RawFrame, language: Option<&str>) -> Result<WindowsOcrResult> {
    recognize_frame(frame, language)
        .map_err(|error| Error::new(Status::GenericFailure, format!("Windows OCR 失败：{error}")))
}

pub struct CaptureOcrTask {
    display_id: String,
    region: (i32, i32, u32, u32),
    language: Option<String>,
    engine: CaptureEngine,
}

impl Task for CaptureOcrTask {
    type Output = WindowsOcrResult;
    type JsValue = WindowsOcrResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let frame = capture_frame(&self.display_id, self.region, self.engine)?;
        recognize(&frame, self.language.as_deref())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi(object)]
pub struct OcrImageRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// JS owns one Arc; each queued OCR task owns another. dispose and GC both drop
/// the handle's Arc, while an in-flight task keeps its pixels alive until completion.
#[napi]
pub struct WindowsOcrImage {
    frame: Option<Arc<RawFrame>>,
    width: u32,
    height: u32,
}

#[napi]
impl WindowsOcrImage {
    #[napi(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[napi(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    #[napi]
    pub fn dispose(&mut self) {
        self.frame.take();
    }

    #[napi]
    pub fn recognize(
        &self,
        region: Option<OcrImageRegion>,
        language: Option<String>,
    ) -> Result<AsyncTask<RecognizeImageTask>> {
        let frame = self
            .frame
            .as_ref()
            .ok_or_else(|| Error::new(Status::InvalidArg, "OCR image has been disposed"))?;
        let crop = if let Some(region) = region {
            let x = region_coordinate(region.x)?;
            let y = region_coordinate(region.y)?;
            let width = region_size(region.width)?;
            let height = region_size(region.height)?;
            if x < 0
                || y < 0
                || x as u64 + width as u64 > self.width as u64
                || y as u64 + height as u64 > self.height as u64
            {
                return Err(Error::new(
                    Status::InvalidArg,
                    "OCR region exceeds image bounds",
                ));
            }
            if x == 0 && y == 0 && width == self.width && height == self.height {
                None
            } else {
                Some((x as u32, y as u32, width, height))
            }
        } else {
            None
        };
        Ok(AsyncTask::new(RecognizeImageTask {
            frame: Arc::clone(frame),
            crop,
            language,
        }))
    }
}

pub struct RecognizeImageTask {
    frame: Arc<RawFrame>,
    crop: Option<(u32, u32, u32, u32)>,
    language: Option<String>,
}

impl Task for RecognizeImageTask {
    type Output = WindowsOcrResult;
    type JsValue = WindowsOcrResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let cropped = self.crop.map(|(x, y, width, height)| {
            let row_bytes = width as usize * 4;
            let stride = self.frame.width as usize * 4;
            let mut pixels = vec![0; row_bytes * height as usize];
            for row in 0..height as usize {
                let start = (y as usize + row) * stride + x as usize * 4;
                pixels[row * row_bytes..(row + 1) * row_bytes]
                    .copy_from_slice(&self.frame.pixels[start..start + row_bytes]);
            }
            RawFrame {
                pixels,
                width,
                height,
            }
        });
        recognize(
            cropped.as_ref().unwrap_or(&self.frame),
            self.language.as_deref(),
        )
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct CaptureImageTask {
    display_id: String,
    region: (i32, i32, u32, u32),
    engine: CaptureEngine,
}

impl Task for CaptureImageTask {
    type Output = RawFrame;
    type JsValue = WindowsOcrImage;

    fn compute(&mut self) -> Result<Self::Output> {
        capture_frame(&self.display_id, self.region, self.engine)
    }

    fn resolve(&mut self, _env: Env, frame: Self::Output) -> Result<Self::JsValue> {
        Ok(WindowsOcrImage {
            width: frame.width,
            height: frame.height,
            frame: Some(Arc::new(frame)),
        })
    }
}

#[napi]
pub fn capture_windows_ocr_image(
    display_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    engine: Option<String>,
) -> Result<AsyncTask<CaptureImageTask>> {
    Ok(AsyncTask::new(CaptureImageTask {
        display_id: normalize_id(&display_id)?,
        region: (
            region_coordinate(x)?,
            region_coordinate(y)?,
            region_size(width)?,
            region_size(height)?,
        ),
        engine: parse_capture_engine(engine)?,
    }))
}

#[napi]
pub fn capture_and_recognize_windows_text(
    display_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    language: Option<String>,
    engine: Option<String>,
) -> Result<AsyncTask<CaptureOcrTask>> {
    Ok(AsyncTask::new(CaptureOcrTask {
        display_id: normalize_id(&display_id)?,
        language,
        engine: parse_capture_engine(engine)?,
        region: (
            region_coordinate(x)?,
            region_coordinate(y)?,
            region_size(width)?,
            region_size(height)?,
        ),
    }))
}
