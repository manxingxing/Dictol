//! MDX adapter for the format-independent DIDX writer. No MDX search is used.
use crate::{DidxBuildResult, DidxIndex, Error, FileKind, IndexEntry, IndexSource, Mdict, Result};
use crate::source::sampled_bytes_fingerprint;
use std::path::Path;

const MDX_FINGERPRINT_SEED: u64 = 0x4d445801;

/// Enumerates MDX keys and encodes their logical record ranges as adapter data.
pub struct MdxIndexSource<'a>(pub &'a Mdict);
impl IndexSource for MdxIndexSource<'_> {
    fn fingerprint(&self) -> Result<u64> {
        // Seed identifies the MDX locator codec version. Use the bounded source sample
        // so opening an index does not scan a large MDX just to check staleness.
        Ok(sampled_bytes_fingerprint(self.0.source_bytes(), MDX_FINGERPRINT_SEED))
    }
    fn entries(&self) -> Result<Box<dyn Iterator<Item = Result<IndexEntry>> + '_>> {
        Ok(Box::new(self.0.keys().map(|key| {
            let key = key?;
            let mut locator = Vec::new();
            encode(&mut locator, key.record_start);
            encode(
                &mut locator,
                key.record_end
                    .checked_sub(key.record_start)
                    .ok_or_else(|| Error::unsupported("MDX reversed record range"))?,
            );
            Ok(IndexEntry {
                key_text: key.text,
                locator,
            })
        })))
    }
}
fn encode(bytes: &mut Vec<u8>, mut n: u64) {
    while n >= 128 {
        bytes.push(n as u8 | 128);
        n >>= 7;
    }
    bytes.push(n as u8);
}
/// Decode MDX adapter data; rejects truncation, overflow and trailing bytes.
pub fn decode_mdx_locator(bytes: &[u8]) -> Result<(u64, u64)> {
    fn take(bytes: &[u8], pos: &mut usize) -> Result<u64> {
        let mut n = 0;
        for shift in (0..70).step_by(7) {
            let b = *bytes
                .get(*pos)
                .ok_or_else(|| Error::unsupported("truncated MDX locator"))?;
            *pos += 1;
            if shift == 63 && b > 1 {
                return Err(Error::unsupported("MDX locator overflow"));
            }
            n |= u64::from(b & 127) << shift;
            if b < 128 {
                return Ok(n);
            }
        }
        Err(Error::unsupported("MDX locator overflow"))
    }
    let mut pos = 0;
    let start = take(bytes, &mut pos)?;
    let len = take(bytes, &mut pos)?;
    let end = start
        .checked_add(len)
        .ok_or_else(|| Error::unsupported("MDX locator overflow"))?;
    if pos != bytes.len() {
        return Err(Error::unsupported("trailing MDX locator bytes"));
    }
    Ok((start, end))
}
impl DidxIndex {
    /// MDX convenience adapter; all indexing/search remains owned by DIDX.
    pub fn build_from_mdx(dictionary: &Mdict, output: impl AsRef<Path>) -> Result<DidxBuildResult> {
        let output = output.as_ref();
        if dictionary.metadata().kind != FileKind::Mdx {
            return Err(Error::unsupported("expected MDX source"));
        }
        if output
            .canonicalize()
            .ok()
            .zip(dictionary.path().canonicalize().ok())
            .is_some_and(|(a, b)| a == b)
        {
            return Err(Error::unsupported("DIDX must not overwrite source"));
        }
        Self::build(&MdxIndexSource(dictionary), output)
    }
}
