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
pub fn read_accessible_text(
    x: i32,
    y: i32,
    include_context: bool,
) -> Result<Option<AccessibleText>, String> {
    read_accessible_text_impl(x, y, include_context).map_err(|error| error.to_string())
}

#[cfg(windows)]
fn read_accessible_text_impl(
    x: i32,
    y: i32,
    include_context: bool,
) -> windows::core::Result<Option<AccessibleText>> {
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
    let raw_word = unsafe { word_range.GetText(-1)? }.to_string();
    let word = raw_word.trim().to_owned();
    // UI Automation represents an image or embedded object as U+FFFC. It is
    // not readable text, so let the caller try screenshot OCR instead.
    if word.is_empty()
        || word.contains('\u{fffc}')
        || !word.chars().any(char::is_alphanumeric)
    {
        return Ok(None);
    }

    // RangeFromPoint can snap to the nearest text outside the actual glyphs.
    // Keep the untrimmed range for this check: UIA word units can include
    // trailing whitespace and punctuation (Chromium adds them so word navigation
    // reaches the next word), and hovering that separator should still resolve
    // to this word.
    let Some(raw_rect) = range_rectangle(&word_range, x, y)? else {
        return Ok(None);
    };
    if !rect_contains(raw_rect, x, y) {
        return Ok(None);
    }
    // Measure only the trimmed text so the highlight does not cover the
    // separators that the UIA word unit includes. Trimming is best effort: any
    // provider failure keeps the untrimmed bounds rather than failing lookup.
    let word_rect = trimmed_range(&word_range, &raw_word, &word)
        .and_then(|range| range_rectangle(&range, x, y).ok().flatten())
        .unwrap_or(raw_rect);
    let [left, top, width, height] = word_rect;

    let (text, offset) = if include_context {
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
        let before = unsafe { prefix.GetText(-1)? }.to_string();
        let text = unsafe { paragraph.GetText(-1)? }.to_string();
        let leading = &raw_word[..raw_word.len() - raw_word.trim_start().len()];
        let Some(after_word_start) = text
            .strip_prefix(&before)
            .and_then(|after| after.strip_prefix(leading))
        else {
            return Ok(None);
        };
        if !after_word_start.starts_with(&word) {
            return Ok(None);
        }
        let offset = before.encode_utf16().count() + leading.encode_utf16().count();
        (text, offset)
    } else {
        (word.clone(), 0)
    };

    Ok(Some(AccessibleText {
        text,
        offset: offset as u32,
        word,
        x: left,
        y: top,
        width,
        height,
    }))
}

#[cfg(not(windows))]
pub fn read_accessible_text(
    _x: i32,
    _y: i32,
    _include_context: bool,
) -> Result<Option<AccessibleText>, String> {
    Err("unsupported-platform".to_owned())
}

#[cfg(windows)]
fn rect_contains(rect: [f64; 4], x: i32, y: i32) -> bool {
    let [left, top, width, height] = rect;
    width > 0.0
        && height > 0.0
        && (x as f64) >= left - 2.0
        && (x as f64) <= left + width + 2.0
        && (y as f64) >= top - 2.0
        && (y as f64) <= top + height + 2.0
}

/// Returns the part of a UIA word unit that equals the trimmed word, or `None`
/// when the unit has no surrounding whitespace, the provider fails, or its
/// character units do not line up with the text.
#[cfg(windows)]
fn trimmed_range(
    range: &windows::Win32::UI::Accessibility::IUIAutomationTextRange,
    raw_word: &str,
    word: &str,
) -> Option<windows::Win32::UI::Accessibility::IUIAutomationTextRange> {
    use windows::Win32::UI::Accessibility::{
        TextPatternRangeEndpoint_End, TextPatternRangeEndpoint_Start, TextUnit_Character,
    };

    if raw_word == word {
        return None;
    }
    let leading = raw_word.chars().take_while(|c| c.is_whitespace()).count() as i32;
    let trailing = raw_word.chars().rev().take_while(|c| c.is_whitespace()).count() as i32;
    if leading == 0 && trailing == 0 {
        return None;
    }
    let trimmed = unsafe { range.Clone() }.ok()?;
    if leading > 0 {
        unsafe {
            trimmed.MoveEndpointByUnit(
                TextPatternRangeEndpoint_Start,
                TextUnit_Character,
                leading,
            )
        }
        .ok()?;
    }
    if trailing > 0 {
        unsafe {
            trimmed.MoveEndpointByUnit(
                TextPatternRangeEndpoint_End,
                TextUnit_Character,
                -trailing,
            )
        }
        .ok()?;
    }
    // Some providers count a CRLF pair as one character; only use the trimmed
    // range when it is exactly the word that will be looked up.
    (unsafe { trimmed.GetText(-1) }.ok()?.to_string() == word).then_some(trimmed)
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
