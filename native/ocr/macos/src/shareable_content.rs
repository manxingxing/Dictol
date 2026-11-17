use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use screencapturekit::cg::CGRect;
use screencapturekit::shareable_content::SCShareableContent;

#[napi(object)]
pub struct CaptureBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl From<CGRect> for CaptureBounds {
    fn from(frame: CGRect) -> Self {
        Self {
            x: frame.origin.x,
            y: frame.origin.y,
            width: frame.size.width,
            height: frame.size.height,
        }
    }
}

#[napi(object)]
pub struct ShareableDisplay {
    pub id: u32,
    pub bounds: CaptureBounds,
}

#[napi(object)]
pub struct ShareableApplication {
    pub process_id: i32,
    pub name: String,
    pub bundle_identifier: String,
}

#[napi(object)]
pub struct ShareableWindow {
    pub id: u32,
    pub title: Option<String>,
    pub bounds: CaptureBounds,
    pub window_layer: i32,
    pub is_on_screen: bool,
    pub application: Option<ShareableApplication>,
}

pub struct ListDisplaysTask;
pub struct ListWindowsTask;

impl Task for ListDisplaysTask {
    type Output = Vec<ShareableDisplay>;
    type JsValue = Vec<ShareableDisplay>;

    fn compute(&mut self) -> Result<Self::Output> {
        let content = SCShareableContent::get()
            .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))?;
        Ok(content
            .displays()
            .into_iter()
            .map(|display| ShareableDisplay {
                id: display.display_id(),
                bounds: display.frame().into(),
            })
            .collect())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

impl Task for ListWindowsTask {
    type Output = Vec<ShareableWindow>;
    type JsValue = Vec<ShareableWindow>;

    fn compute(&mut self) -> Result<Self::Output> {
        // 只列出屏幕上的窗口；窗口可能在获取列表后关闭或改变状态。
        let content = SCShareableContent::create()
            .with_on_screen_windows_only(true)
            .get()
            .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))?;
        let displays = content.displays();
        Ok(content
            .windows()
            .into_iter()
            .filter_map(|window| {
                let frame = window.frame();
                if frame.size.width <= 0.0
                    || frame.size.height <= 0.0
                    || !displays.iter().any(|display| {
                        super::screen_capture::overlap_area(display.frame(), frame) > 0.0
                    })
                {
                    return None;
                }
                let application = window.owning_application().map(|app| ShareableApplication {
                    process_id: app.process_id(),
                    name: app.application_name(),
                    bundle_identifier: app.bundle_identifier(),
                });
                Some(ShareableWindow {
                    id: window.window_id(),
                    title: window.title(),
                    bounds: frame.into(),
                    window_layer: window.window_layer(),
                    is_on_screen: window.is_on_screen(),
                    application,
                })
            })
            .collect())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// 异步枚举 ScreenCaptureKit 提供的显示器。
#[napi(ts_return_type = "Promise<ShareableDisplay[]>")]
pub fn list_shareable_displays() -> AsyncTask<ListDisplaysTask> {
    AsyncTask::new(ListDisplaysTask)
}

/// 异步枚举与显示器相交的屏幕窗口，供独立窗口截图使用。
#[napi(ts_return_type = "Promise<ShareableWindow[]>")]
pub fn list_shareable_windows() -> AsyncTask<ListWindowsTask> {
    AsyncTask::new(ListWindowsTask)
}
