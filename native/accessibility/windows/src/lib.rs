#[cfg(windows)]
mod ui_automation;

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Result, Task};
use napi_derive::napi;

#[cfg(windows)]
#[napi(object)]
pub struct AccessibleText {
    pub text: String,
    pub offset: u32,
    pub word: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(windows)]
#[napi(object)]
pub struct AccessibleLookup {
    pub result: Option<AccessibleText>,
    pub failure: Option<String>,
}

#[cfg(windows)]
pub struct ReadAccessibleTextTask {
    x: i32,
    y: i32,
    include_context: bool,
}

#[cfg(windows)]
impl Task for ReadAccessibleTextTask {
    type Output = AccessibleLookup;
    type JsValue = AccessibleLookup;

    fn compute(&mut self) -> Result<Self::Output> {
        match ui_automation::read_accessible_text(self.x, self.y, self.include_context) {
            Ok(Some(result)) => Ok(AccessibleLookup {
                result: Some(AccessibleText {
                    text: result.text,
                    offset: result.offset,
                    word: result.word,
                    x: result.x,
                    y: result.y,
                    width: result.width,
                    height: result.height,
                }),
                failure: None,
            }),
            Ok(None) => Ok(AccessibleLookup {
                result: None,
                failure: Some("no-text-at-point".into()),
            }),
            Err(error) => Ok(AccessibleLookup {
                result: None,
                failure: Some(format!("uia-error: {error}")),
            }),
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[cfg(windows)]
#[napi(
    js_name = "readAccessibleText",
    ts_return_type = "Promise<AccessibleLookup>"
)]
pub fn read_accessible_text(
    x: f64,
    y: f64,
    include_context: bool,
) -> AsyncTask<ReadAccessibleTextTask> {
    AsyncTask::new(ReadAccessibleTextTask {
        x: x.round() as i32,
        y: y.round() as i32,
        include_context,
    })
}
