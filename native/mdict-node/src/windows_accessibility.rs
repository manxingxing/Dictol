use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Result, Task};
use napi_derive::napi;

#[napi(object)]
pub struct WindowsAccessibleText {
    pub text: String,
    pub offset: u32,
    pub word: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[napi(object)]
pub struct WindowsAccessibleLookup {
    pub result: Option<WindowsAccessibleText>,
    pub failure: Option<String>,
}

pub struct ReadWindowsAccessibleTextTask {
    x: i32,
    y: i32,
}

impl Task for ReadWindowsAccessibleTextTask {
    type Output = WindowsAccessibleLookup;
    type JsValue = WindowsAccessibleLookup;

    fn compute(&mut self) -> Result<Self::Output> {
        #[cfg(windows)]
        {
            match read_accessible_text(self.x, self.y) {
                Ok(Some(result)) => Ok(WindowsAccessibleLookup {
                    result: Some(result),
                    failure: None,
                }),
                Ok(None) => Ok(WindowsAccessibleLookup {
                    result: None,
                    failure: Some("no-text-at-point".into()),
                }),
                Err(error) => Ok(WindowsAccessibleLookup {
                    result: None,
                    failure: Some(format!("uia-error: {error}")),
                }),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (self.x, self.y);
            Ok(WindowsAccessibleLookup {
                result: None,
                failure: Some("unsupported-platform".into()),
            })
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi(ts_return_type = "Promise<WindowsAccessibleLookup>")]
pub fn read_windows_accessible_text(x: i32, y: i32) -> AsyncTask<ReadWindowsAccessibleTextTask> {
    AsyncTask::new(ReadWindowsAccessibleTextTask { x, y })
}

#[cfg(windows)]
fn read_accessible_text(x: i32, y: i32) -> windows::core::Result<Option<WindowsAccessibleText>> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
        CoUninitialize,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern, TextPatternRangeEndpoint_End,
        TextPatternRangeEndpoint_Start, TextUnit_Paragraph, TextUnit_Word, UIA_TextPatternId,
    };

    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    // UI Automation is called on the N-API worker, away from Electron's UI thread.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
    let _apartment = Apartment;
    let automation: IUIAutomation =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)? };
    let point = POINT { x, y };
    let mut element = unsafe { automation.ElementFromPoint(point)? };
    let walker = unsafe { automation.ControlViewWalker()? };
    let mut text_pattern: Option<IUIAutomationTextPattern> = None;
    // Text leaf nodes in browsers often expose TextPattern only on their parent.
    for _ in 0..8 {
        if let Ok(pattern) = unsafe { element.GetCurrentPatternAs(UIA_TextPatternId) } {
            text_pattern = Some(pattern);
            break;
        }
        let Ok(parent) = (unsafe { walker.GetParentElement(&element) }) else {
            break;
        };
        element = parent;
    }
    let Some(pattern) = text_pattern else {
        return Ok(None);
    };
    let at_point = unsafe { pattern.RangeFromPoint(point)? };
    let word_range = unsafe { at_point.Clone()? };
    unsafe { word_range.ExpandToEnclosingUnit(TextUnit_Word)? };
    let word = unsafe { word_range.GetText(256)? }
        .to_string()
        .trim()
        .to_owned();
    // UI Automation represents an image or embedded object as U+FFFC. It is
    // not readable text, so let the caller try screenshot OCR instead.
    if word.is_empty()
        || word.contains('\u{fffc}')
        || !word.chars().any(char::is_alphanumeric)
        || word.encode_utf16().count() > 128
    {
        return Ok(None);
    }

    // RangeFromPoint can snap to the nearest text outside the actual glyphs.
    let Some([left, top, width, height]) = range_rectangle(&word_range, x, y)? else {
        return Ok(None);
    };
    if width <= 0.0
        || height <= 0.0
        || (x as f64) < left - 2.0
        || (x as f64) > left + width + 2.0
        || (y as f64) < top - 2.0
        || (y as f64) > top + height + 2.0
    {
        return Ok(None);
    }

    let paragraph = unsafe { at_point.Clone()? };
    unsafe { paragraph.ExpandToEnclosingUnit(TextUnit_Paragraph)? };
    let prefix = unsafe { paragraph.Clone()? };
    unsafe {
        prefix.MoveEndpointByRange(
            TextPatternRangeEndpoint_End,
            &word_range,
            TextPatternRangeEndpoint_Start,
        )?;
    }
    let before = unsafe { prefix.GetText(16_384)? }.to_string();
    let text = unsafe { paragraph.GetText(16_384)? }.to_string();
    let offset = before.encode_utf16().count();
    if offset >= text.encode_utf16().count() {
        return Ok(None);
    }
    Ok(Some(WindowsAccessibleText {
        text,
        offset: offset as u32,
        word,
        x: left,
        y: top,
        width,
        height,
    }))
}

#[cfg(windows)]
fn range_rectangle(
    range: &windows::Win32::UI::Accessibility::IUIAutomationTextRange,
    x: i32,
    y: i32,
) -> windows::core::Result<Option<[f64; 4]>> {
    use windows::Win32::System::Ole::{
        SafeArrayDestroy, SafeArrayGetElement, SafeArrayGetLBound, SafeArrayGetUBound,
    };

    let array = unsafe { range.GetBoundingRectangles()? };
    if array.is_null() {
        return Ok(None);
    }
    let read = || -> windows::core::Result<Option<[f64; 4]>> {
        let lower = unsafe { SafeArrayGetLBound(array, 1)? };
        let upper = unsafe { SafeArrayGetUBound(array, 1)? };
        let mut nearest = None;
        let mut nearest_distance = f64::INFINITY;
        for start in (lower..=upper.saturating_sub(3)).step_by(4) {
            let mut rect = [0.0; 4];
            for (index, value) in rect.iter_mut().enumerate() {
                unsafe {
                    SafeArrayGetElement(array, &(start + index as i32), (value as *mut f64).cast())?
                };
            }
            let dx = (rect[0] - x as f64)
                .max(0.0)
                .max(x as f64 - rect[0] - rect[2]);
            let dy = (rect[1] - y as f64)
                .max(0.0)
                .max(y as f64 - rect[1] - rect[3]);
            let distance = dx * dx + dy * dy;
            if distance < nearest_distance {
                nearest = Some(rect);
                nearest_distance = distance;
            }
        }
        Ok(nearest)
    }();
    let _ = unsafe { SafeArrayDestroy(array) };
    read
}
