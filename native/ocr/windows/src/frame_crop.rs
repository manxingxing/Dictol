/// Copy a top-left-origin BGRA rectangle into tightly packed rows.
pub(super) fn crop_bgra(
    pixels: &[u8],
    frame_width: u32,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
) -> Vec<u8> {
    let width = right - left;
    let height = bottom - top;
    let mut output = Vec::with_capacity(width as usize * height as usize * 4);
    for row in top..bottom {
        let offset = (row as usize * frame_width as usize + left as usize) * 4;
        output.extend_from_slice(&pixels[offset..offset + width as usize * 4]);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::crop_bgra;

    #[test]
    fn crops_bgra_rows_without_swapping_channels() {
        let pixels = [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
            25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
        ];
        assert_eq!(
            crop_bgra(&pixels, 3, 1, 1, 3, 3),
            [
                17, 18, 19, 20, 21, 22, 23, 24, 29, 30, 31, 32, 33, 34, 35, 36,
            ]
        );
        assert_eq!(crop_bgra(&pixels, 3, 0, 0, 3, 3), pixels);
    }
}
