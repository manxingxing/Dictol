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
    pub characters: Vec<WindowsOcrCharacterBox>,
}

#[napi(object)]
pub struct WindowsOcrCharacterBox {
    pub start: u32,
    pub length: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
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
            recognize(&self.png, self.language.as_deref()).map_err(|error| {
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
fn recognize(png: &[u8], language: Option<&str>) -> windows::core::Result<WindowsOcrResult> {
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat,
        BitmapTransform, ColorManagementMode, ExifOrientationMode,
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

    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream)?;
    writer.WriteBytes(png)?;
    writer.StoreAsync()?.join()?;
    writer.DetachStream()?;
    stream.Seek(0)?;

    let decoder = BitmapDecoder::CreateAsync(&stream)?.join()?;
    let original_width = decoder.PixelWidth()?;
    let original_height = decoder.PixelHeight()?;
    let max_dimension = OcrEngine::MaxImageDimension()?;
    // Small labels in illustrations are often only a dozen physical pixels
    // high. Enlarge the crop before recognition while keeping memory bounded.
    let longest_edge = original_width.max(original_height);
    let scale = (max_dimension.min(3_200) as f64 / longest_edge as f64).min(3.0);
    let bitmap = if (scale - 1.0).abs() > 0.001 {
        let transform = BitmapTransform::new()?;
        transform.SetScaledWidth((original_width as f64 * scale).round().max(1.0) as u32)?;
        transform.SetScaledHeight((original_height as f64 * scale).round().max(1.0) as u32)?;
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
    let image_width = bitmap.PixelWidth()? as f64;
    let image_height = bitmap.PixelHeight()? as f64;
    let lines = engine.RecognizeAsync(&bitmap)?.join()?.Lines()?;
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
        let mut characters = Vec::new();
        let mut cursor = 0;
        for word in &recognized_words {
            let Some(relative_start) = text[cursor..].find(&word.text) else {
                continue;
            };
            let start = cursor + relative_start;
            let utf16_start = text[..start].encode_utf16().count() as u32;
            let box_x = word.left as f64 / image_width;
            let box_y = 1.0 - word.bottom as f64 / image_height;
            let box_width = (word.right - word.left) as f64 / image_width;
            let box_height = (word.bottom - word.top) as f64 / image_height;
            let mut offset = utf16_start;
            for ch in word.text.chars() {
                let length = ch.len_utf16() as u32;
                characters.push(WindowsOcrCharacterBox {
                    start: offset,
                    length,
                    x: box_x,
                    y: box_y,
                    width: box_width,
                    height: box_height,
                });
                offset += length;
            }
            cursor = start + word.text.len();
        }
        observations.push(WindowsOcrObservation {
            text,
            x: left as f64 / image_width,
            y: 1.0 - bottom as f64 / image_height,
            width: (right - left) as f64 / image_width,
            height: (bottom - top) as f64 / image_height,
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
