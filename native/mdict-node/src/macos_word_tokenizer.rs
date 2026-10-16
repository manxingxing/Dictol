use napi_derive::napi;

#[napi(object)]
pub struct WordRange {
    pub start: u32,
    pub length: u32,
}

#[napi]
pub fn chinese_word_range(text: String, offset: u32) -> Option<WordRange> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;

        unsafe extern "C" {
            fn dictol_chinese_word_range(
                text: *const std::ffi::c_char,
                offset: u32,
                start: *mut u32,
                length: *mut u32,
            ) -> i32;
        }

        let text = CString::new(text).ok()?;
        let mut start = 0;
        let mut length = 0;
        let found =
            unsafe { dictol_chinese_word_range(text.as_ptr(), offset, &mut start, &mut length) };
        (found == 1).then_some(WordRange { start, length })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (text, offset);
        None
    }
}
