use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

#[napi(object)]
#[cfg_attr(target_os = "macos", derive(serde::Deserialize))]
pub struct MacAccessibleText {
    pub text: String,
    pub offset: u32,
    pub word: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(object)]
#[cfg_attr(target_os = "macos", derive(serde::Deserialize))]
pub struct MacAccessibleLookup {
    pub result: Option<MacAccessibleText>,
    pub failure: Option<String>,
}

pub struct ReadMacAccessibleTextTask {
    x: f64,
    y: f64,
    include_context: bool,
}

impl Task for ReadMacAccessibleTextTask {
    type Output = MacAccessibleLookup;
    type JsValue = MacAccessibleLookup;

    fn compute(&mut self) -> Result<Self::Output> {
        #[cfg(target_os = "macos")]
        {
            use std::ptr;

            unsafe extern "C" {
                fn dictol_read_mac_accessible_text(
                    x: f64,
                    y: f64,
                    include_context: i32,
                    output: *mut *mut u8,
                    output_length: *mut usize,
                ) -> i32;
                fn dictol_free_mac_accessible_text(output: *mut u8);
            }

            let mut output = ptr::null_mut();
            let mut output_length = 0;
            let status = unsafe {
                dictol_read_mac_accessible_text(
                    self.x,
                    self.y,
                    i32::from(self.include_context),
                    &mut output,
                    &mut output_length,
                )
            };
            if status != 1 || output.is_null() {
                return Err(Error::new(
                    Status::GenericFailure,
                    "macOS Accessibility lookup failed",
                ));
            }
            let json = unsafe { std::slice::from_raw_parts(output, output_length).to_vec() };
            unsafe { dictol_free_mac_accessible_text(output) };
            let response: MacAccessibleLookup = serde_json::from_slice(&json)
                .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))?;
            Ok(response)
        }
        #[cfg(not(target_os = "macos"))]
        {
            Ok(MacAccessibleLookup {
                result: None,
                failure: Some("unsupported-platform".to_string()),
            })
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<MacAccessibleLookup>")]
pub fn read_mac_accessible_text(
    x: f64,
    y: f64,
    include_context: bool,
) -> AsyncTask<ReadMacAccessibleTextTask> {
    AsyncTask::new(ReadMacAccessibleTextTask {
        x,
        y,
        include_context,
    })
}
