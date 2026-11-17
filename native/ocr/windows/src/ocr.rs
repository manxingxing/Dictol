use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

#[napi(object)]
pub struct WindowsOcrObservation {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub quad: Vec<WindowsOcrPoint>,
    pub characters: Vec<WindowsOcrCharacterBox>,
}

#[napi(object)]
#[derive(Clone)]
pub struct WindowsOcrPoint {
    pub x: f64,
    pub y: f64,
}

#[napi(object)]
pub struct WindowsOcrCharacterBox {
    pub start: u32,
    pub length: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub quad: Vec<WindowsOcrPoint>,
}

#[napi(object)]
pub struct WindowsOcrResult {
    pub observations: Vec<WindowsOcrObservation>,
    pub recognizer_language: String,
    pub input_width: u32,
    pub input_height: u32,
    pub processed_width: u32,
    pub processed_height: u32,
    pub max_image_dimension: u32,
    pub text_angle: Option<f64>,
}

#[cfg(windows)]
struct RotatedBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    quad: Vec<WindowsOcrPoint>,
}

#[cfg(windows)]
fn rotated_box(
    left: f32,
    top: f32,
    right: f32,
    bottom: f32,
    angle: f64,
    image_width: f64,
    image_height: f64,
) -> RotatedBox {
    let radians = angle.to_radians();
    let (sin, cos) = radians.sin_cos();
    let center_x = image_width / 2.0;
    let center_y = image_height / 2.0;
    let quad: Vec<_> = [(left, top), (right, top), (right, bottom), (left, bottom)]
        .into_iter()
        .map(|(x, y)| {
            let dx = x as f64 - center_x;
            let dy = y as f64 - center_y;
            WindowsOcrPoint {
                x: (center_x + dx * cos - dy * sin) / image_width,
                y: (center_y + dx * sin + dy * cos) / image_height,
            }
        })
        .collect();
    let x = quad
        .iter()
        .map(|point| point.x)
        .fold(f64::INFINITY, f64::min);
    let top = quad
        .iter()
        .map(|point| point.y)
        .fold(f64::INFINITY, f64::min);
    let right = quad
        .iter()
        .map(|point| point.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let bottom = quad
        .iter()
        .map(|point| point.y)
        .fold(f64::NEG_INFINITY, f64::max);
    RotatedBox {
        x,
        y: 1.0 - bottom,
        width: right - x,
        height: bottom - top,
        quad,
    }
}

#[cfg(any(windows, test))]
struct RecognizedWord {
    text: String,
    left: f32,
    top: f32,
    right: f32,
    bottom: f32,
    width: f32,
}

#[cfg(any(windows, test))]
fn repair_split_latin_words(line: &str, words: &[RecognizedWord]) -> String {
    let tokens: Vec<_> = line.split_whitespace().collect();
    if tokens.len() != words.len()
        || !tokens
            .iter()
            .zip(words)
            .all(|(token, word)| *token == word.text)
    {
        return line.to_owned();
    }

    let mut repaired = String::new();
    let mut changed = false;
    for (index, word) in words.iter().enumerate() {
        if index > 0 {
            let previous = &words[index - 1];
            let latin_pair = previous.text.ends_with(|ch: char| ch.is_ascii_alphabetic())
                && word.text.starts_with(|ch: char| ch.is_ascii_alphabetic());
            let previous_glyph_width = previous.width / previous.text.chars().count().max(1) as f32;
            let glyph_width = word.width / word.text.chars().count().max(1) as f32;
            let gap = word.left - previous.right;
            if latin_pair && gap <= previous_glyph_width.min(glyph_width) * 0.25 {
                changed = true;
            } else {
                repaired.push(' ');
            }
        }
        repaired.push_str(&word.text);
    }
    if changed { repaired } else { line.to_owned() }
}

pub struct RecognizeWindowsTextTask {
    png: Vec<u8>,
    language: Option<String>,
}

impl Task for RecognizeWindowsTextTask {
    type Output = WindowsOcrResult;
    type JsValue = WindowsOcrResult;

    fn compute(&mut self) -> Result<Self::Output> {
        #[cfg(windows)]
        {
            let started = std::time::Instant::now();
            let result = recognize(Input::Png(&self.png), self.language.as_deref());
            eprintln!(
                "[Native OCR] PNG recognition elapsedMs={:.2}",
                started.elapsed().as_secs_f64() * 1000.0
            );
            result.map_err(|error| {
                Error::new(Status::GenericFailure, format!("Windows OCR 失败：{error}"))
            })
        }
        #[cfg(not(windows))]
        {
            let _ = (&self.png, &self.language);
            Err(Error::new(
                Status::GenericFailure,
                "Windows OCR requires Windows",
            ))
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<WindowsOcrResult>")]
pub fn recognize_windows_text(
    png: Buffer,
    language: Option<String>,
) -> Result<AsyncTask<RecognizeWindowsTextTask>> {
    if png.is_empty() {
        return Err(Error::new(Status::InvalidArg, "Empty screenshot"));
    }
    Ok(AsyncTask::new(RecognizeWindowsTextTask {
        png: png.to_vec(),
        language,
    }))
}

#[cfg(windows)]
enum Input<'a> {
    Png(&'a [u8]),
    Bgra(&'a [u8], u32, u32),
}

#[cfg(windows)]
fn recognize(input: Input<'_>, language: Option<&str>) -> windows::core::Result<WindowsOcrResult> {
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat,
        BitmapTransform, ColorManagementMode, ExifOrientationMode, SoftwareBitmap,
    };
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
    use windows::core::{Error as WindowsError, HRESULT, HSTRING, Interface};

    struct WinRtApartment;
    impl Drop for WinRtApartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    // N-API runs this task on a worker thread. WinRT must be initialized there.
    unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
    let _apartment = WinRtApartment;

    let engine = match language {
        Some(tag) => {
            let requested_language = Language::CreateLanguage(&HSTRING::from(tag))?;
            OcrEngine::TryCreateFromLanguage(&requested_language)?
        }
        None => OcrEngine::TryCreateFromUserProfileLanguages()?,
    };
    if engine.as_raw().is_null() {
        return Err(WindowsError::new(
            HRESULT(0x80004005u32 as i32),
            "未找到匹配的 Windows OCR 语言包，请在系统设置中安装 OCR 语言包",
        ));
    }
    let recognizer_language = engine.RecognizerLanguage()?.LanguageTag()?.to_string();

    let max_dimension = OcrEngine::MaxImageDimension()?;
    let (bitmap, original_width, original_height) = match input {
        Input::Png(png) => {
            let stream = InMemoryRandomAccessStream::new()?;
            let writer = DataWriter::CreateDataWriter(&stream)?;
            writer.WriteBytes(png)?;
            writer.StoreAsync()?.join()?;
            writer.DetachStream()?;
            stream.Seek(0)?;
            let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
            let width = decoder.PixelWidth()?;
            let height = decoder.PixelHeight()?;
            let scale = (max_dimension.min(3_200) as f64 / width.max(height) as f64).min(3.0);
            let bitmap = if (scale - 1.0).abs() > 0.001 {
                let transform = BitmapTransform::new()?;
                transform.SetScaledWidth((width as f64 * scale).round().max(1.0) as u32)?;
                transform.SetScaledHeight((height as f64 * scale).round().max(1.0) as u32)?;
                transform.SetInterpolationMode(BitmapInterpolationMode::Cubic)?;
                decoder
                    .GetSoftwareBitmapTransformedAsync(
                        BitmapPixelFormat::Bgra8,
                        BitmapAlphaMode::Premultiplied,
                        &transform,
                        ExifOrientationMode::IgnoreExifOrientation,
                        ColorManagementMode::DoNotColorManage,
                    )?
                    .join()?
            } else {
                decoder
                    .GetSoftwareBitmapConvertedAsync(
                        BitmapPixelFormat::Bgra8,
                        BitmapAlphaMode::Premultiplied,
                    )?
                    .join()?
            };
            (bitmap, width, height)
        }
        Input::Bgra(pixels, width, height) => {
            use windows::Win32::Graphics::Imaging::{
                CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA, IWICImagingFactory,
                WICBitmapInterpolationModeCubic,
            };
            use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
            let scale = (max_dimension.min(3_200) as f64 / width.max(height) as f64).min(3.0);
            let scaled_width = (width as f64 * scale).round().max(1.0) as u32;
            let scaled_height = (height as f64 * scale).round().max(1.0) as u32;
            let resized;
            let pixels = if scaled_width != width || scaled_height != height {
                let factory: IWICImagingFactory = unsafe {
                    CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?
                };
                let source = unsafe {
                    factory.CreateBitmapFromMemory(
                        width,
                        height,
                        &GUID_WICPixelFormat32bppPBGRA,
                        width * 4,
                        pixels,
                    )?
                };
                let scaler = unsafe { factory.CreateBitmapScaler()? };
                unsafe {
                    scaler.Initialize(
                        &source,
                        scaled_width,
                        scaled_height,
                        WICBitmapInterpolationModeCubic,
                    )?;
                }
                let mut output = vec![0; scaled_width as usize * scaled_height as usize * 4];
                unsafe {
                    scaler.CopyPixels(std::ptr::null(), scaled_width * 4, &mut output)?;
                }
                resized = output;
                resized.as_slice()
            } else {
                pixels
            };
            let writer = DataWriter::new()?;
            writer.WriteBytes(pixels)?;
            let buffer = writer.DetachBuffer()?;
            let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
                &buffer,
                BitmapPixelFormat::Bgra8,
                scaled_width as i32,
                scaled_height as i32,
                BitmapAlphaMode::Premultiplied,
            )?;
            (bitmap, width, height)
        }
    };
    let image_width = bitmap.PixelWidth()? as f64;
    let image_height = bitmap.PixelHeight()? as f64;
    let ocr_result = engine.RecognizeAsync(&bitmap)?.join()?;
    let text_angle = ocr_result
        .TextAngle()
        .ok()
        .and_then(|angle| angle.Value().ok())
        .filter(|angle| angle.is_finite());
    let lines = ocr_result.Lines()?;
    let mut observations = Vec::with_capacity(lines.Size()? as usize);
    for line in lines {
        let text = line.Text()?.to_string();
        let words = line.Words()?;
        if text.trim().is_empty() || words.Size()? == 0 {
            continue;
        }
        let mut left = f32::MAX;
        let mut top = f32::MAX;
        let mut right = f32::MIN;
        let mut bottom = f32::MIN;
        let mut recognized_words = Vec::with_capacity(words.Size()? as usize);
        for word in words {
            let rect = word.BoundingRect()?;
            left = left.min(rect.X);
            top = top.min(rect.Y);
            right = right.max(rect.X + rect.Width);
            bottom = bottom.max(rect.Y + rect.Height);
            recognized_words.push(RecognizedWord {
                text: word.Text()?.to_string(),
                left: rect.X,
                top: rect.Y,
                right: rect.X + rect.Width,
                bottom: rect.Y + rect.Height,
                width: rect.Width,
            });
        }
        if right <= left || bottom <= top {
            continue;
        }
        let text = repair_split_latin_words(&text, &recognized_words);
        let line_box = rotated_box(
            left,
            top,
            right,
            bottom,
            text_angle.unwrap_or(0.0),
            image_width,
            image_height,
        );
        let mut characters = Vec::new();
        let mut cursor = 0;
        for word in &recognized_words {
            let Some(relative_start) = text[cursor..].find(&word.text) else {
                continue;
            };
            let start = cursor + relative_start;
            let utf16_start = text[..start].encode_utf16().count() as u32;
            let word_box = rotated_box(
                word.left,
                word.top,
                word.right,
                word.bottom,
                text_angle.unwrap_or(0.0),
                image_width,
                image_height,
            );
            let mut offset = utf16_start;
            for ch in word.text.chars() {
                let length = ch.len_utf16() as u32;
                characters.push(WindowsOcrCharacterBox {
                    start: offset,
                    length,
                    x: word_box.x,
                    y: word_box.y,
                    width: word_box.width,
                    height: word_box.height,
                    quad: word_box.quad.clone(),
                });
                offset += length;
            }
            cursor = start + word.text.len();
        }
        observations.push(WindowsOcrObservation {
            text,
            x: line_box.x,
            y: line_box.y,
            width: line_box.width,
            height: line_box.height,
            quad: line_box.quad,
            characters,
        });
    }
    Ok(WindowsOcrResult {
        observations,
        recognizer_language,
        input_width: original_width,
        input_height: original_height,
        processed_width: image_width as u32,
        processed_height: image_height as u32,
        max_image_dimension: max_dimension,
        text_angle,
    })
}

#[cfg(test)]
mod tests {
    use super::{RecognizedWord, repair_split_latin_words};

    #[test]
    fn joins_only_latin_fragments_without_a_visible_word_gap() {
        let words = [
            RecognizedWord {
                text: "there".into(),
                left: 0.0,
                top: 0.0,
                right: 35.0,
                bottom: 10.0,
                width: 35.0,
            },
            RecognizedWord {
                text: "a".into(),
                left: 40.0,
                top: 0.0,
                right: 47.0,
                bottom: 10.0,
                width: 7.0,
            },
            RecognizedWord {
                text: "re".into(),
                left: 48.0,
                top: 0.0,
                right: 62.0,
                bottom: 10.0,
                width: 14.0,
            },
            RecognizedWord {
                text: "three".into(),
                left: 68.0,
                top: 0.0,
                right: 103.0,
                bottom: 10.0,
                width: 35.0,
            },
        ];
        assert_eq!(
            repair_split_latin_words("there a re three", &words),
            "there are three"
        );
        assert_eq!(
            repair_split_latin_words("there a re three", &words[..3]),
            "there a re three"
        );
    }

    #[test]
    fn keeps_separate_words_when_their_boxes_have_a_space() {
        let words = [
            RecognizedWord {
                text: "an".into(),
                left: 0.0,
                top: 0.0,
                right: 14.0,
                bottom: 10.0,
                width: 14.0,
            },
            RecognizedWord {
                text: "image".into(),
                left: 20.0,
                top: 0.0,
                right: 55.0,
                bottom: 10.0,
                width: 35.0,
            },
        ];
        assert_eq!(repair_split_latin_words("an image", &words), "an image");
    }
}

#[cfg(windows)]
#[napi(object)]
pub struct OcrCrop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(windows)]
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

#[cfg(windows)]
#[napi(object, object_from_js = false)]
pub struct WindowsCaptureOcrResult {
    pub snapshot: napi::bindgen_prelude::External<
        std::sync::Mutex<Option<std::sync::Arc<super::windows_screen_capture::RawFrame>>>,
    >,
    pub snapshot_width: u32,
    pub snapshot_height: u32,
    pub result: WindowsOcrResult,
    pub capture_ms: f64,
    pub ocr_ms: f64,
}

#[cfg(windows)]
#[napi(object)]
pub struct WindowsSnapshotOcrResult {
    pub result: WindowsOcrResult,
    pub ocr_ms: f64,
}

#[cfg(windows)]
fn recognize_frame(
    frame: &super::windows_screen_capture::RawFrame,
    crop: Option<&OcrCrop>,
    language: Option<&str>,
) -> Result<WindowsSnapshotOcrResult> {
    let start = std::time::Instant::now();
    let cropped;
    let (pixels, width, height) = if let Some(crop) = crop {
        let left = (crop.x * frame.width as f64).round() as u32;
        let top = (crop.y * frame.height as f64).round() as u32;
        let right = ((crop.x + crop.width) * frame.width as f64).round() as u32;
        let bottom = ((crop.y + crop.height) * frame.height as f64).round() as u32;
        let width = right - left;
        let height = bottom - top;
        if width == 0 || height == 0 {
            return Err(Error::new(
                Status::InvalidArg,
                "OCR crop is smaller than one pixel",
            ));
        }
        cropped =
            super::frame_crop::crop_bgra(&frame.pixels, frame.width, left, top, right, bottom);
        (cropped.as_slice(), width, height)
    } else {
        (frame.pixels.as_slice(), frame.width, frame.height)
    };
    let result = recognize(Input::Bgra(pixels, width, height), language).map_err(|error| {
        Error::new(Status::GenericFailure, format!("Windows OCR 失败：{error}"))
    })?;
    Ok(WindowsSnapshotOcrResult {
        result,
        ocr_ms: start.elapsed().as_secs_f64() * 1000.0,
    })
}

#[cfg(windows)]
pub struct CaptureOcrTask {
    id: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    crop: Option<OcrCrop>,
    language: Option<String>,
}
#[cfg(windows)]
pub struct CaptureOcrOutput {
    frame: std::sync::Arc<super::windows_screen_capture::RawFrame>,
    result: WindowsSnapshotOcrResult,
    capture_ms: f64,
}
#[cfg(windows)]
impl Task for CaptureOcrTask {
    type Output = CaptureOcrOutput;
    type JsValue = WindowsCaptureOcrResult;
    fn compute(&mut self) -> Result<Self::Output> {
        let start = std::time::Instant::now();
        let frame = super::windows_screen_capture::capture_region_raw(
            self.id.clone(),
            self.x,
            self.y,
            self.width,
            self.height,
        )
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
        let ocr_start = std::time::Instant::now();
        let result = recognize_frame(&frame, self.crop.as_ref(), self.language.as_deref());
        eprintln!(
            "[Native OCR] recognition elapsedMs={:.2}",
            ocr_start.elapsed().as_secs_f64() * 1000.0
        );
        let result = result?;
        Ok(CaptureOcrOutput {
            frame: std::sync::Arc::new(frame),
            result,
            capture_ms,
        })
    }
    fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(WindowsCaptureOcrResult {
            snapshot_width: output.frame.width,
            snapshot_height: output.frame.height,
            snapshot: napi::bindgen_prelude::External::new(std::sync::Mutex::new(Some(
                output.frame,
            ))),
            result: output.result.result,
            capture_ms: output.capture_ms,
            ocr_ms: output.result.ocr_ms,
        })
    }
}
#[cfg(windows)]
#[napi]
pub fn capture_and_recognize_windows_text(
    display_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    crop: Option<OcrCrop>,
    language: Option<String>,
) -> Result<AsyncTask<CaptureOcrTask>> {
    let (id, x, y, width, height) =
        super::windows_screen_capture::validate_capture_region(&display_id, x, y, width, height)?;
    Ok(AsyncTask::new(CaptureOcrTask {
        id,
        x,
        y,
        width,
        height,
        crop: checked_crop(crop)?,
        language,
    }))
}
#[cfg(windows)]
pub struct SnapshotOcrTask {
    frame: std::sync::Arc<super::windows_screen_capture::RawFrame>,
    crop: Option<OcrCrop>,
    language: Option<String>,
}
#[cfg(windows)]
impl Task for SnapshotOcrTask {
    type Output = WindowsSnapshotOcrResult;
    type JsValue = WindowsSnapshotOcrResult;
    fn compute(&mut self) -> Result<Self::Output> {
        let start = std::time::Instant::now();
        let result = recognize_frame(&self.frame, self.crop.as_ref(), self.language.as_deref());
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
#[cfg(windows)]
#[napi]
pub fn recognize_windows_snapshot(
    snapshot: &napi::bindgen_prelude::External<
        std::sync::Mutex<Option<std::sync::Arc<super::windows_screen_capture::RawFrame>>>,
    >,
    crop: Option<OcrCrop>,
    language: Option<String>,
) -> Result<AsyncTask<SnapshotOcrTask>> {
    let frame = snapshot
        .lock()
        .map_err(|_| Error::new(Status::GenericFailure, "Snapshot lock failed"))?
        .as_ref()
        .cloned()
        .ok_or_else(|| Error::new(Status::InvalidArg, "Snapshot has been released"))?;
    Ok(AsyncTask::new(SnapshotOcrTask {
        frame,
        crop: checked_crop(crop)?,
        language,
    }))
}

#[cfg(windows)]
#[napi]
pub fn release_windows_snapshot(
    snapshot: &napi::bindgen_prelude::External<
        std::sync::Mutex<Option<std::sync::Arc<super::windows_screen_capture::RawFrame>>>,
    >,
) -> Result<()> {
    snapshot
        .lock()
        .map_err(|_| Error::new(Status::GenericFailure, "Snapshot lock failed"))?
        .take();
    Ok(())
}
