use napi::bindgen_prelude::{AsyncTask, Buffer, External};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use screencapturekit::cg::CGRect;
use screencapturekit::screenshot_manager::CGImage;
use std::ffi::{CString, c_void};
use std::sync::{Arc, Mutex};
use std::time::Instant;

unsafe extern "C" {
    fn dictol_recognize_mac_image(
        image: *mut c_void,
        languages: *const i8,
        auto_detect: i32,
        output: *mut *mut u8,
        length: *mut usize,
    ) -> i32;
    fn dictol_recognize_mac_text(
        png: *const u8,
        png_length: usize,
        languages: *const i8,
        auto_detect: i32,
        output: *mut *mut u8,
        length: *mut usize,
    ) -> i32;
    fn dictol_free_mac_ocr_json(bytes: *mut u8);
    fn dictol_chinese_word_range(
        text: *const i8,
        offset: u32,
        start: *mut u32,
        length: *mut u32,
    ) -> i32;
    fn CGImageCreateWithImageInRect(image: *mut c_void, rect: CGRect) -> *mut c_void;
}

#[napi(object)]
pub struct OcrCrop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(object, object_from_js = false)]
pub struct MacCaptureOcrResult {
    pub snapshot: External<Mutex<Option<Arc<CGImage>>>>,
    pub snapshot_width: u32,
    pub snapshot_height: u32,
    pub json: String,
    pub width: u32,
    pub height: u32,
    pub capture_ms: f64,
    pub ocr_ms: f64,
}

#[napi(object)]
pub struct MacOcrImageResult {
    pub json: String,
    pub width: u32,
    pub height: u32,
    pub ocr_ms: f64,
}

fn languages(values: Vec<String>) -> Result<CString> {
    if values
        .iter()
        .any(|value| value.contains(',') || value.contains('\0'))
    {
        return Err(Error::new(
            Status::InvalidArg,
            "OCR languages cannot contain commas or null characters",
        ));
    }
    CString::new(values.join(","))
        .map_err(|_| Error::new(Status::InvalidArg, "Invalid OCR languages"))
}

fn checked_crop(crop: Option<OcrCrop>) -> Result<Option<OcrCrop>> {
    if let Some(crop) = &crop {
        if ![crop.x, crop.y, crop.width, crop.height]
            .iter()
            .all(|n| n.is_finite())
            || crop.x < 0.0
            || crop.y < 0.0
            || crop.width <= 0.0
            || crop.height <= 0.0
            || crop.x + crop.width > 1.0
            || crop.y + crop.height > 1.0
        {
            return Err(Error::new(
                Status::InvalidArg,
                "Invalid normalized OCR crop",
            ));
        }
    }
    Ok(crop)
}

fn recognize_image(
    image: &CGImage,
    crop: Option<&OcrCrop>,
    languages: &CString,
    auto_detect: bool,
) -> Result<MacOcrImageResult> {
    let start = Instant::now();
    let cropped = if let Some(crop) = crop {
        let width = image.width() as f64;
        let height = image.height() as f64;
        let left = (crop.x * width).round();
        let top = (crop.y * height).round();
        let right = ((crop.x + crop.width) * width).round();
        let bottom = ((crop.y + crop.height) * height).round();
        let raw = unsafe {
            CGImageCreateWithImageInRect(
                image.as_ptr(),
                CGRect::new(left, top, right - left, bottom - top),
            )
        };
        if raw.is_null() {
            return Err(Error::new(
                Status::GenericFailure,
                "Could not crop captured image",
            ));
        }
        Some(unsafe { CGImage::from_raw(raw) })
    } else {
        None
    };
    let input = cropped.as_ref().unwrap_or(image);
    let mut bytes = std::ptr::null_mut();
    let mut length = 0;
    let success = unsafe {
        dictol_recognize_mac_image(
            input.as_ptr(),
            languages.as_ptr(),
            auto_detect as i32,
            &mut bytes,
            &mut length,
        )
    };
    if success == 0 || bytes.is_null() {
        return Err(Error::new(
            Status::GenericFailure,
            "macOS Vision OCR failed",
        ));
    }
    let json =
        String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(bytes, length) }).into_owned();
    unsafe { dictol_free_mac_ocr_json(bytes) };
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    Ok(MacOcrImageResult {
        json,
        width: input.width() as u32,
        height: input.height() as u32,
        ocr_ms: elapsed,
    })
}

pub struct CaptureOcrTask {
    display_id: u32,
    rect: CGRect,
    crop: Option<OcrCrop>,
    languages: CString,
    auto_detect: bool,
}
pub struct CaptureOcrOutput {
    image: Arc<CGImage>,
    result: MacOcrImageResult,
    capture_ms: f64,
}
impl Task for CaptureOcrTask {
    type Output = CaptureOcrOutput;
    type JsValue = MacCaptureOcrResult;
    fn compute(&mut self) -> Result<Self::Output> {
        let start = Instant::now();
        let image = super::screen_capture::capture_region_image(self.display_id, self.rect)
            .map_err(|error| {
                eprintln!(
                    "[Native OCR] capture failed elapsedMs={:.2}",
                    start.elapsed().as_secs_f64() * 1000.0
                );
                Error::new(
                    Status::GenericFailure,
                    format!("DICTOL_CAPTURE_ERROR: {error}"),
                )
            })?;
        let capture_ms = start.elapsed().as_secs_f64() * 1000.0;
        eprintln!("[Native OCR] capture elapsedMs={capture_ms:.2}");
        let ocr_start = Instant::now();
        let result = recognize_image(
            &image,
            self.crop.as_ref(),
            &self.languages,
            self.auto_detect,
        );
        eprintln!(
            "[Native OCR] recognition elapsedMs={:.2}",
            ocr_start.elapsed().as_secs_f64() * 1000.0
        );
        let result = result?;
        Ok(CaptureOcrOutput {
            image: Arc::new(image),
            result,
            capture_ms,
        })
    }
    fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(MacCaptureOcrResult {
            snapshot_width: output.image.width() as u32,
            snapshot_height: output.image.height() as u32,
            snapshot: External::new(Mutex::new(Some(output.image))),
            json: output.result.json,
            width: output.result.width,
            height: output.result.height,
            capture_ms: output.capture_ms,
            ocr_ms: output.result.ocr_ms,
        })
    }
}

#[napi]
pub fn capture_and_recognize_mac_text(
    display_id: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    crop: Option<OcrCrop>,
    language_list: Vec<String>,
    auto_detect: bool,
) -> Result<AsyncTask<CaptureOcrTask>> {
    if ![x, y, width, height].iter().all(|n| n.is_finite()) || width <= 0.0 || height <= 0.0 {
        return Err(Error::new(Status::InvalidArg, "Invalid screen region"));
    }
    Ok(AsyncTask::new(CaptureOcrTask {
        display_id: super::screen_capture::validate_id(display_id)?,
        rect: CGRect::new(x, y, width, height),
        crop: checked_crop(crop)?,
        languages: languages(language_list)?,
        auto_detect,
    }))
}

pub struct SnapshotOcrTask {
    image: Arc<CGImage>,
    crop: Option<OcrCrop>,
    languages: CString,
    auto_detect: bool,
}
impl Task for SnapshotOcrTask {
    type Output = MacOcrImageResult;
    type JsValue = MacOcrImageResult;
    fn compute(&mut self) -> Result<Self::Output> {
        let start = Instant::now();
        let result = recognize_image(
            &self.image,
            self.crop.as_ref(),
            &self.languages,
            self.auto_detect,
        );
        eprintln!(
            "[Native OCR] snapshot recognition elapsedMs={:.2}",
            start.elapsed().as_secs_f64() * 1000.0
        );
        result
    }
    fn resolve(&mut self, _: Env, result: Self::Output) -> Result<Self::JsValue> {
        Ok(result)
    }
}
#[napi]
pub fn recognize_mac_snapshot(
    snapshot: &External<Mutex<Option<Arc<CGImage>>>>,
    crop: Option<OcrCrop>,
    language_list: Vec<String>,
    auto_detect: bool,
) -> Result<AsyncTask<SnapshotOcrTask>> {
    let image = snapshot
        .lock()
        .map_err(|_| Error::new(Status::GenericFailure, "Snapshot lock failed"))?
        .as_ref()
        .cloned()
        .ok_or_else(|| Error::new(Status::InvalidArg, "Snapshot has been released"))?;
    Ok(AsyncTask::new(SnapshotOcrTask {
        image,
        crop: checked_crop(crop)?,
        languages: languages(language_list)?,
        auto_detect,
    }))
}

#[napi]
pub fn release_mac_snapshot(snapshot: &External<Mutex<Option<Arc<CGImage>>>>) -> Result<()> {
    snapshot
        .lock()
        .map_err(|_| Error::new(Status::GenericFailure, "Snapshot lock failed"))?
        .take();
    Ok(())
}

pub struct PngOcrTask {
    png: Vec<u8>,
    languages: CString,
    auto_detect: bool,
}
impl Task for PngOcrTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        let started = Instant::now();
        let mut bytes = std::ptr::null_mut();
        let mut length = 0;
        let success = unsafe {
            dictol_recognize_mac_text(
                self.png.as_ptr(),
                self.png.len(),
                self.languages.as_ptr(),
                self.auto_detect as i32,
                &mut bytes,
                &mut length,
            )
        };
        eprintln!(
            "[Native OCR] PNG recognition elapsedMs={:.2}",
            started.elapsed().as_secs_f64() * 1000.0
        );
        if success == 0 || bytes.is_null() {
            return Err(Error::new(
                Status::GenericFailure,
                "macOS Vision OCR failed",
            ));
        }
        let json = String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(bytes, length) })
            .into_owned();
        unsafe { dictol_free_mac_ocr_json(bytes) };
        Ok(json)
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        Ok(output)
    }
}
#[napi]
pub fn recognize_mac_png(
    png: Buffer,
    language_list: Vec<String>,
    auto_detect: bool,
) -> Result<AsyncTask<PngOcrTask>> {
    if png.is_empty() {
        return Err(Error::new(
            Status::InvalidArg,
            "OCR screenshot must be a nonempty Buffer",
        ));
    }
    Ok(AsyncTask::new(PngOcrTask {
        png: png.to_vec(),
        languages: languages(language_list)?,
        auto_detect,
    }))
}

#[napi(object)]
pub struct WordRange {
    pub start: u32,
    pub length: u32,
}
#[napi]
pub fn chinese_word_range(text: String, offset: u32) -> Result<Option<WordRange>> {
    let text =
        CString::new(text).map_err(|_| Error::new(Status::InvalidArg, "Text contains null"))?;
    let (mut start, mut length) = (0, 0);
    if unsafe { dictol_chinese_word_range(text.as_ptr(), offset, &mut start, &mut length) } == 0 {
        return Ok(None);
    }
    Ok(Some(WordRange { start, length }))
}
