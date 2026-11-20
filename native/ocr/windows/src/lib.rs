#[cfg(any(windows, test))]
mod ocr;
#[cfg(windows)]
mod windows_screen_capture;
