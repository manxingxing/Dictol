use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use std::sync::mpsc;
use std::time::Duration;
use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, HMONITOR, MONITOR_DEFAULTTONULL, MONITORINFO, MonitorFromPoint,
};
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{ImageEncoder, ImageEncoderPixelFormat, ImageFormat};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl};
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

#[napi(object)]
pub struct ScreenCaptureImage {
    pub png: Buffer,
    pub width: u32,
    pub height: u32,
}

#[napi(object)]
pub struct CaptureBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[napi(object)]
pub struct ShareableDisplay {
    pub id: String,
    pub bounds: CaptureBounds,
    pub name: Option<String>,
}

#[napi(object)]
pub struct ShareableApplication {
    pub process_id: u32,
    pub name: Option<String>,
}

#[napi(object)]
pub struct ShareableWindow {
    pub id: String,
    pub bounds: CaptureBounds,
    pub title: Option<String>,
    pub application: Option<ShareableApplication>,
}

#[napi(object)]
pub struct WindowsDisplayBounds {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

fn native_error(error: impl std::fmt::Display) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

/// 将 Windows 句柄编码为字符串，避免 JavaScript 数字丢失指针精度。
fn handle_id(ptr: *mut std::ffi::c_void) -> String {
    format!("{:x}", ptr as usize)
}

fn normalize_id(id: &str) -> Result<String> {
    usize::from_str_radix(id, 16)
        .ok()
        .filter(|value| *value != 0)
        .map(|value| format!("{value:x}"))
        .ok_or_else(|| Error::new(Status::InvalidArg, "Invalid Windows capture ID"))
}

fn region_coordinate(value: f64) -> Result<i32> {
    if !value.is_finite()
        || value.fract() != 0.0
        || value < i32::MIN as f64
        || value > i32::MAX as f64
    {
        return Err(Error::new(Status::InvalidArg, "Invalid screen region"));
    }
    Ok(value as i32)
}

fn region_size(value: f64) -> Result<u32> {
    if !value.is_finite() || value.fract() != 0.0 || value < 1.0 || value > u32::MAX as f64 {
        return Err(Error::new(Status::InvalidArg, "Invalid screen region"));
    }
    Ok(value as u32)
}

fn monitor_bounds(monitor: &Monitor) -> Result<CaptureBounds> {
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(HMONITOR(monitor.as_raw_hmonitor()), &mut info) }.as_bool() {
        return Err(native_error(windows::core::Error::from_thread()));
    }
    let rect = info.rcMonitor;
    Ok(CaptureBounds {
        x: rect.left,
        y: rect.top,
        width: (i64::from(rect.right) - i64::from(rect.left)) as u32,
        height: (i64::from(rect.bottom) - i64::from(rect.top)) as u32,
    })
}

fn find_monitor(id: &str) -> Result<Monitor> {
    Monitor::enumerate()
        .map_err(native_error)?
        .into_iter()
        .find(|monitor| handle_id(monitor.as_raw_hmonitor()) == id)
        .ok_or_else(|| native_error(format!("Display {id} was not found")))
}

#[napi]
pub fn get_windows_display_bounds_at_point(x: i32, y: i32) -> Result<WindowsDisplayBounds> {
    let handle = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONULL) };
    if handle.is_invalid() {
        return Err(native_error("Point is outside a display"));
    }
    let monitor = Monitor::from_raw_hmonitor(handle.0);
    let bounds = monitor_bounds(&monitor)?;
    Ok(WindowsDisplayBounds {
        id: handle_id(handle.0),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    })
}

pub struct ListDisplaysTask;
pub struct ListWindowsTask;

impl Task for ListDisplaysTask {
    type Output = Vec<ShareableDisplay>;
    type JsValue = Vec<ShareableDisplay>;
    fn compute(&mut self) -> Result<Self::Output> {
        Monitor::enumerate()
            .map_err(native_error)?
            .into_iter()
            .map(|monitor| {
                Ok(ShareableDisplay {
                    id: handle_id(monitor.as_raw_hmonitor()),
                    bounds: monitor_bounds(&monitor)?,
                    name: monitor.name().ok(),
                })
            })
            .collect()
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

impl Task for ListWindowsTask {
    type Output = Vec<ShareableWindow>;
    type JsValue = Vec<ShareableWindow>;
    fn compute(&mut self) -> Result<Self::Output> {
        Window::enumerate()
            .map_err(native_error)?
            .into_iter()
            .map(|window| {
                let rect = window.rect().map_err(native_error)?;
                let process_id = window.process_id().ok();
                Ok(ShareableWindow {
                    id: handle_id(window.as_raw_hwnd()),
                    bounds: CaptureBounds {
                        x: rect.left,
                        y: rect.top,
                        width: (i64::from(rect.right) - i64::from(rect.left)).max(0) as u32,
                        height: (i64::from(rect.bottom) - i64::from(rect.top)).max(0) as u32,
                    },
                    title: window.title().ok(),
                    application: process_id.map(|process_id| ShareableApplication {
                        process_id,
                        name: window.process_name().ok(),
                    }),
                })
            })
            .collect()
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<ShareableDisplay[]>")]
pub fn list_shareable_displays() -> AsyncTask<ListDisplaysTask> {
    AsyncTask::new(ListDisplaysTask)
}
#[napi(ts_return_type = "Promise<ShareableWindow[]>")]
pub fn list_shareable_windows() -> AsyncTask<ListWindowsTask> {
    AsyncTask::new(ListWindowsTask)
}

#[derive(Clone, Copy)]
struct Crop {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

enum Target {
    Display {
        id: String,
        region: Option<(i32, i32, u32, u32)>,
    },
    Window {
        id: String,
    },
}
pub struct CaptureTask {
    target: Target,
}

impl Task for CaptureTask {
    type Output = ScreenCaptureImage;
    type JsValue = ScreenCaptureImage;
    fn compute(&mut self) -> Result<Self::Output> {
        let frame = capture_target(&self.target)?;
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe { RoUninitialize() };
            }
        }
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(native_error)?;
        let _apartment = Apartment;
        let encoder = ImageEncoder::new(ImageFormat::Png, ImageEncoderPixelFormat::Bgra8)
            .map_err(native_error)?;
        let png = encoder
            .encode(&frame.pixels, frame.width, frame.height)
            .map_err(native_error)?;
        Ok(ScreenCaptureImage {
            png: png.into(),
            width: frame.width,
            height: frame.height,
        })
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

fn capture_target(target: &Target) -> Result<RawFrame> {
    match target {
        Target::Display { id, region } => {
            let monitor = find_monitor(id)?;
            let crop = if let Some((x, y, width, height)) = region {
                let bounds = monitor_bounds(&monitor)?;
                let left = i64::from(*x) - i64::from(bounds.x);
                let top = i64::from(*y) - i64::from(bounds.y);
                if left < 0
                    || top < 0
                    || left + i64::from(*width) > i64::from(bounds.width)
                    || top + i64::from(*height) > i64::from(bounds.height)
                {
                    return Err(native_error(
                        "Screen region must be contained in the specified display",
                    ));
                }
                Some(Crop {
                    x: left as u32,
                    y: top as u32,
                    width: *width,
                    height: *height,
                })
            } else {
                None
            };
            capture_one(monitor, crop)
        }
        Target::Window { id } => {
            let window = Window::enumerate()
                .map_err(native_error)?
                .into_iter()
                .find(|window| handle_id(window.as_raw_hwnd()) == *id)
                .ok_or_else(|| native_error(format!("Window {id} was not found")))?;
            capture_one(window, None)
        }
    }
}

struct RawFrame {
    pixels: Vec<u8>,
    width: u32,
    height: u32,
}

#[napi(ts_return_type = "Promise<ScreenCaptureImage>")]
pub fn capture_display(display_id: String) -> Result<AsyncTask<CaptureTask>> {
    let display_id = normalize_id(&display_id)?;
    Ok(AsyncTask::new(CaptureTask {
        target: Target::Display {
            id: display_id,
            region: None,
        },
    }))
}
#[napi(ts_return_type = "Promise<ScreenCaptureImage>")]
pub fn capture_window(window_id: String) -> Result<AsyncTask<CaptureTask>> {
    let window_id = normalize_id(&window_id)?;
    Ok(AsyncTask::new(CaptureTask {
        target: Target::Window { id: window_id },
    }))
}
#[napi(ts_return_type = "Promise<ScreenCaptureImage>")]
pub fn capture_screen_region(
    display_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<AsyncTask<CaptureTask>> {
    let display_id = normalize_id(&display_id)?;
    let (x, y, width, height) = (
        region_coordinate(x)?,
        region_coordinate(y)?,
        region_size(width)?,
        region_size(height)?,
    );
    Ok(AsyncTask::new(CaptureTask {
        target: Target::Display {
            id: display_id,
            region: Some((x, y, width, height)),
        },
    }))
}

struct CaptureFlags {
    reply: mpsc::SyncSender<std::result::Result<(Vec<u8>, u32, u32), String>>,
    crop: Option<Crop>,
}
struct SingleFrame {
    flags: Option<CaptureFlags>,
}

impl GraphicsCaptureApiHandler for SingleFrame {
    type Flags = CaptureFlags;
    type Error = String;
    fn new(context: Context<Self::Flags>) -> std::result::Result<Self, Self::Error> {
        Ok(Self {
            flags: Some(context.flags),
        })
    }
    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _control: InternalCaptureControl,
    ) -> std::result::Result<(), Self::Error> {
        let Some(flags) = self.flags.take() else {
            return Ok(());
        };
        let result = (|| -> std::result::Result<(Vec<u8>, u32, u32), String> {
            let crop = flags.crop.unwrap_or(Crop {
                x: 0,
                y: 0,
                width: frame.width(),
                height: frame.height(),
            });
            let right = crop
                .x
                .checked_add(crop.width)
                .ok_or("Invalid capture rectangle")?;
            let bottom = crop
                .y
                .checked_add(crop.height)
                .ok_or("Invalid capture rectangle")?;
            if right > frame.width() || bottom > frame.height() {
                return Err("Capture rectangle exceeds frame".into());
            }
            // 只把请求区域从 GPU 纹理复制到 CPU 可读的 staging texture。
            let buffer = frame
                .buffer_crop(crop.x, crop.y, right, bottom)
                .map_err(|error| error.to_string())?;
            let mut scratch = Vec::new();
            let pixels = buffer.as_nopadding_buffer(&mut scratch);
            Ok((pixels.to_vec(), crop.width, crop.height))
        })();
        let _ = flags.reply.send(result);
        Ok(())
    }
    fn on_closed(&mut self) -> std::result::Result<(), Self::Error> {
        if let Some(flags) = self.flags.take() {
            let _ = flags.reply.send(Err("Capture target closed".into()));
        }
        Ok(())
    }
}

/// 每次请求启动单次 WGC 会话，取得一帧后停止；应用层负责失败回退。
fn capture_one<T: TryInto<GraphicsCaptureItemType> + Send + 'static>(
    item: T,
    crop: Option<Crop>,
) -> Result<RawFrame> {
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(native_error)?;
    let _apartment = Apartment;
    let cursor = if GraphicsCaptureApi::is_cursor_settings_supported().map_err(native_error)? {
        CursorCaptureSettings::WithoutCursor
    } else {
        CursorCaptureSettings::Default
    };
    let (sender, receiver) = mpsc::sync_channel(1);
    let settings = Settings::new(
        item,
        cursor,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        CaptureFlags {
            reply: sender,
            crop,
        },
    );
    let capture = SingleFrame::start_free_threaded(settings).map_err(native_error)?;
    let result = receiver
        .recv_timeout(Duration::from_secs(3))
        .map_err(native_error);
    let stop = capture.stop().map_err(native_error);
    let (pixels, width, height) = result?.map_err(native_error)?;
    stop?;
    Ok(RawFrame {
        pixels,
        width,
        height,
    })
}
