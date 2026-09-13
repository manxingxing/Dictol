use std::fs::File;
use std::path::{Path, PathBuf};

use memmap2::Mmap;
use xxhash_rust::xxh64::Xxh64;

use crate::{Error, Result};

const FINGERPRINT_SAMPLE_SIZE: usize = 64 * 1024;

/// A physical source range validated once when a descriptor is constructed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SourceSpan {
    pub(crate) start: usize,
    pub(crate) end: usize,
}

/// Read-only memory mapping of one physical MDX/MDD file.
#[derive(Debug)]
pub(crate) struct MappedSource {
    path: PathBuf,
    map: Mmap,
}

impl MappedSource {
    /// 打开文件并建立只读内存映射。
    pub(crate) fn open(path: &Path) -> Result<Self> {
        let file = File::open(path).map_err(|error| Error::io(path, error))?;
        // SAFETY: this library creates a read-only mapping and never mutates the file.
        // Callers must not truncate or replace an opened dictionary in place.
        let map = unsafe { Mmap::map(&file) }.map_err(|error| Error::io(path, error))?;
        Ok(Self {
            path: path.to_path_buf(),
            map,
        })
    }

    /// 返回映射对应的原始文件路径。
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// 返回完整文件的只读字节切片。
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.map
    }

    /// 验证一个文件物理范围并转换为内部 `SourceSpan`。
    pub(crate) fn span(&self, start: u64, end: u64, context: &str) -> Result<SourceSpan> {
        let start_usize = usize::try_from(start).map_err(|_| {
            Error::invalid(
                &self.path,
                start,
                format!("{context} offset exceeds platform"),
            )
        })?;
        let end_usize = usize::try_from(end).map_err(|_| {
            Error::invalid(
                &self.path,
                end,
                format!("{context} offset exceeds platform"),
            )
        })?;
        if end_usize < start_usize || end_usize > self.map.len() {
            return Err(Error::invalid(
                &self.path,
                start,
                format!(
                    "{context} range {start}..{end} exceeds file size {}",
                    self.map.len()
                ),
            ));
        }
        Ok(SourceSpan {
            start: start_usize,
            end: end_usize,
        })
    }

    /// 读取已经验证的物理范围，不再重复执行边界检查。
    #[inline]
    pub(crate) fn slice(&self, span: SourceSpan) -> &[u8] {
        debug_assert!(span.start <= span.end && span.end <= self.map.len());
        &self.map[span.start..span.end]
    }
}

/// 对内存映射文件执行有界读取量的 XXH64 抽样。
pub(crate) fn sampled_bytes_fingerprint(bytes: &[u8], seed: u64) -> u64 {
    let mut hasher = Xxh64::new(seed);
    hasher.update(&(bytes.len() as u64).to_le_bytes());

    if bytes.len() <= FINGERPRINT_SAMPLE_SIZE * 3 {
        hasher.update(bytes);
    } else {
        let offsets = [
            0,
            (bytes.len() - FINGERPRINT_SAMPLE_SIZE) / 2,
            bytes.len() - FINGERPRINT_SAMPLE_SIZE,
        ];
        for offset in offsets {
            hasher.update(&bytes[offset..offset + FINGERPRINT_SAMPLE_SIZE]);
        }
    }

    hasher.digest()
}

#[cfg(test)]
mod tests {
    use super::sampled_bytes_fingerprint;

    #[test]
    fn samples_size_and_head_middle_tail_without_scanning_the_whole_file() {
        let mut original = vec![0u8; 64 * 1024 * 4];
        original[0] = 1;
        let middle_offset = original.len() / 2;
        let tail_offset = original.len() - 1;
        original[middle_offset] = 2;
        original[tail_offset] = 3;
        let fingerprint = sampled_bytes_fingerprint(&original, 42);

        let mut middle = original.clone();
        middle[64 * 1024 + 1] ^= 1;
        assert_eq!(sampled_bytes_fingerprint(&middle, 42), fingerprint);

        let mut head = original.clone();
        head[0] ^= 1;
        assert_ne!(sampled_bytes_fingerprint(&head, 42), fingerprint);

        let mut tail = original;
        let last = tail.len() - 1;
        tail[last] ^= 1;
        assert_ne!(sampled_bytes_fingerprint(&tail, 42), fingerprint);
    }
}
