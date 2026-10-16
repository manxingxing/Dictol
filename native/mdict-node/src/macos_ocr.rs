use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

#[napi(object)]
pub struct MacOcrCharacterBox {
    pub start: u32,
    pub length: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(object)]
pub struct MacOcrObservation {
    pub text: String,
    pub confidence: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub characters: Vec<MacOcrCharacterBox>,
}

#[napi(object)]
pub struct MacOcrResult {
    pub observations: Vec<MacOcrObservation>,
}

pub struct RecognizeMacTextTask {
    png: Vec<u8>,
    languages: Vec<String>,
    accurate: bool,
}

#[cfg(target_os = "macos")]
#[derive(serde::Deserialize)]
struct RawMacOcrResponse {
    error: Option<String>,
    observations: Option<Vec<RawMacOcrObservation>>,
}

#[cfg(target_os = "macos")]
#[derive(serde::Deserialize)]
struct RawMacOcrObservation {
    text: String,
    confidence: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    characters: Vec<RawMacOcrCharacterBox>,
}

#[cfg(target_os = "macos")]
#[derive(serde::Deserialize)]
struct RawMacOcrCharacterBox {
    start: u32,
    length: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Task for RecognizeMacTextTask {
    type Output = MacOcrResult;
    type JsValue = MacOcrResult;

    fn compute(&mut self) -> Result<Self::Output> {
        #[cfg(target_os = "macos")]
        {
            use std::ffi::CString;
            use std::ptr;

            unsafe extern "C" {
                fn dictol_recognize_mac_text(
                    png: *const u8,
                    png_length: usize,
                    languages: *const std::ffi::c_char,
                    accurate: i32,
                    output: *mut *mut u8,
                    output_length: *mut usize,
                ) -> i32;
                fn dictol_free_mac_ocr_json(output: *mut u8);
            }

            let languages = CString::new(self.languages.join(","))
                .map_err(|_| Error::new(Status::InvalidArg, "Invalid OCR language"))?;
            let mut output = ptr::null_mut();
            let mut output_length = 0;
            let status = unsafe {
                dictol_recognize_mac_text(
                    self.png.as_ptr(),
                    self.png.len(),
                    languages.as_ptr(),
                    i32::from(self.accurate),
                    &mut output,
                    &mut output_length,
                )
            };
            if status != 1 || output.is_null() {
                return Err(Error::new(
                    Status::GenericFailure,
                    "macOS Vision OCR failed",
                ));
            }
            let json = unsafe { std::slice::from_raw_parts(output, output_length).to_vec() };
            unsafe { dictol_free_mac_ocr_json(output) };
            let response: RawMacOcrResponse = serde_json::from_slice(&json)
                .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))?;
            if let Some(message) = response.error {
                return Err(Error::new(Status::GenericFailure, message));
            }
            Ok(MacOcrResult {
                observations: response
                    .observations
                    .unwrap_or_default()
                    .into_iter()
                    .map(|line| MacOcrObservation {
                        text: line.text,
                        confidence: line.confidence,
                        x: line.x,
                        y: line.y,
                        width: line.width,
                        height: line.height,
                        characters: line
                            .characters
                            .into_iter()
                            .map(|box_| MacOcrCharacterBox {
                                start: box_.start,
                                length: box_.length,
                                x: box_.x,
                                y: box_.y,
                                width: box_.width,
                                height: box_.height,
                            })
                            .collect(),
                    })
                    .collect(),
            })
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err(Error::new(
                Status::GenericFailure,
                "macOS Vision OCR is unavailable on this platform",
            ))
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<MacOcrResult>")]
pub fn recognize_mac_text(
    png: Buffer,
    languages: Vec<String>,
    accurate: bool,
) -> AsyncTask<RecognizeMacTextTask> {
    AsyncTask::new(RecognizeMacTextTask {
        png: png.to_vec(),
        languages,
        accurate,
    })
}
