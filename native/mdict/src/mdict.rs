use std::cmp::Ordering;
use std::ops::Range;
use std::path::Path;
use std::sync::Arc;

use zeroize::Zeroizing;

use crate::block;
use crate::cache::BlockCache;
use crate::comparison::KeyComparison;
use crate::format::directory::{KeyBlock, KeyDirectory, RecordBlock, RecordDirectory};
use crate::format::{self, Header};
use crate::model::{Entry, FileKind, Key, Metadata};
use crate::options::OpenOptions;
use crate::record;
use crate::scanner::{Entries, KeyScanner, Keys, Prefix};
use crate::source::MappedSource;
use crate::{Error, Result};

/// One physical MDX or MDD file opened for random and sequential access.
pub struct Mdict {
    source: Arc<MappedSource>,
    metadata: Metadata,
    pub(crate) header: Header,
    pub(crate) key_directory: KeyDirectory,
    pub(crate) record_directory: RecordDirectory,
    pub(crate) comparison: KeyComparison,
    pub(crate) crypto_key: Zeroizing<Vec<u8>>,
    pub(crate) options: OpenOptions,
    key_cache: BlockCache<u32>,
    record_cache: BlockCache<u32>,
}

impl Mdict {
    /// 使用默认限制和缓存配置打开一份物理 MDX/MDD 文件。
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with_options(path, OpenOptions::default())
    }

    /// 使用调用方配置打开一份物理 MDX/MDD 文件。
    pub fn open_with_options(path: impl AsRef<Path>, options: OpenOptions) -> Result<Self> {
        let path = path.as_ref();
        let source = Arc::new(MappedSource::open(path)?);
        let opened = format::open(&source, path, &options)?;
        Ok(Self {
            source,
            metadata: opened.metadata,
            header: opened.header,
            key_directory: opened.key_directory,
            record_directory: opened.record_directory,
            comparison: opened.comparison,
            crypto_key: opened.crypto_key,
            key_cache: BlockCache::new(options.cache.key_blocks_bytes),
            record_cache: BlockCache::new(options.cache.record_blocks_bytes),
            options,
        })
    }

    /// 返回当前内存映射对应的文件路径。
    pub fn path(&self) -> &Path {
        self.source.path()
    }

    pub(crate) fn source_bytes(&self) -> &[u8] {
        self.source.bytes()
    }

    /// 返回文件的 MDX/MDD 语义类型。
    pub fn kind(&self) -> FileKind {
        self.metadata.kind
    }

    /// 返回版本无关的公开元数据。
    pub fn metadata(&self) -> &Metadata {
        &self.metadata
    }

    /// 返回 Header 中的原始 `Encrypted` 位标记，供绑定层保留兼容信息。
    pub fn encryption_flags(&self) -> u8 {
        self.header.encrypted
    }

    /// 返回解压后 record 逻辑地址空间的总字节数。
    pub fn record_size(&self) -> u64 {
        self.record_directory.total_decoded_size
    }

    /// 按文件原始顺序流式遍历全部 key。
    pub fn keys(&self) -> Keys<'_> {
        Keys {
            dictionary: self,
            scanner: KeyScanner::sequential(0),
            finished: false,
        }
    }

    /// 按文件原始顺序流式遍历 key 与原始 record。
    pub fn entries(&self) -> Entries<'_> {
        Entries::new(self)
    }

    /// 返回 comparison-equal 候选中标点、空格和大小写语义最接近查询的 key。
    ///
    /// v1/v2 会先应用大小写规则但保留 StripKey 字符；若不存在这种优先匹配，
    /// 再回退到文件顺序中的第一个规范化匹配。
    pub fn find_key(&self, key: &str) -> Result<Option<Key>> {
        let mut preferred = None;
        let mut fallback = None;
        for candidate in self.find_keys(key)? {
            if candidate.text == key {
                return Ok(Some(candidate));
            }
            if self.comparison.is_preferred_match(&candidate.text, key) {
                preferred.get_or_insert(candidate);
                continue;
            }
            fallback.get_or_insert(candidate);
        }
        Ok(preferred.or(fallback))
    }

    /// 返回比较规则下所有精确匹配的重复 key。
    pub fn find_keys(&self, key: &str) -> Result<Vec<Key>> {
        let blocks = self.candidate_blocks(key, false);
        let mut scanner = KeyScanner::random_range(blocks.start, blocks.end);
        let mut matches = Vec::new();
        while let Some(candidate) = scanner.next_key(self)? {
            match self.comparison.compare(&candidate.text, key) {
                Ordering::Less => continue,
                Ordering::Equal => matches.push(candidate),
                Ordering::Greater => continue,
            }
        }
        Ok(matches)
    }

    /// 创建一个流式前缀查询迭代器。
    pub fn prefix(&self, prefix: &str) -> Result<Prefix<'_>> {
        let blocks = self.candidate_blocks(prefix, true);
        Ok(Prefix::new(
            self,
            KeyScanner::random_range(blocks.start, blocks.end),
            prefix.to_owned(),
        ))
    }

    /// 从解压后逻辑地址空间读取一个可能横跨多个 block 的 record。
    pub fn read_record(&self, record_start: u64, record_end: u64) -> Result<Vec<u8>> {
        record::read_random(self, record_start, record_end)
    }

    /// 精确查找 key 并返回未经文本处理的 record bytes。
    pub fn lookup(&self, key: &str) -> Result<Option<Entry>> {
        let Some(found) = self.find_key(key)? else {
            return Ok(None);
        };
        Ok(Some(Entry {
            key: found.text,
            data: self.read_record(found.record_start, found.record_end)?,
        }))
    }

    /// 精确查找 key，并按文件原始顺序返回全部匹配 record 的原始 bytes。
    pub fn lookup_all(&self, key: &str) -> Result<Vec<Entry>> {
        self.find_keys(key)?
            .into_iter()
            .map(|found| {
                self.read_record(found.record_start, found.record_end)
                    .map(|data| Entry {
                        key: found.text,
                        data,
                    })
            })
            .collect()
    }

    /// 二分定位所有首尾边界可能与查询值重叠的 Key Block 范围。
    fn candidate_blocks(&self, query: &str, prefix: bool) -> Range<usize> {
        if !self.key_directory.binary_searchable {
            return 0..self.key_directory.blocks.len();
        }
        let start = self.key_directory.blocks.partition_point(|block| {
            let ordering = if prefix {
                self.comparison
                    .prefix_compare_boundary(&block.comparison_last_key, query)
            } else {
                self.comparison
                    .compare_boundary(&block.comparison_last_key, query)
            };
            ordering == Ordering::Less
        });
        let end = self.key_directory.blocks.partition_point(|block| {
            let ordering = if prefix {
                self.comparison
                    .prefix_compare_boundary(&block.comparison_first_key, query)
            } else {
                self.comparison
                    .compare_boundary(&block.comparison_first_key, query)
            };
            ordering != Ordering::Greater
        });
        start..end.max(start)
    }

    /// 返回私有 Key Block 描述表。
    pub(crate) fn key_blocks(&self) -> &[KeyBlock] {
        &self.key_directory.blocks
    }

    /// 返回私有 Record Block 描述表。
    pub(crate) fn record_blocks(&self) -> &[RecordBlock] {
        &self.record_directory.blocks
    }

    /// 解码指定 Key Block，可选择是否使用随机查询缓存。
    pub(crate) fn decode_key_block(&self, index: usize, cache: bool) -> Result<Arc<[u8]>> {
        let descriptor = self.key_directory.blocks.get(index).ok_or_else(|| {
            Error::invalid(
                self.path(),
                0,
                format!("key block index {index} is out of range"),
            )
        })?;
        let load = || self.decode_key_block_uncached(descriptor);
        if cache {
            self.key_cache.get_or_try_insert(descriptor.id.0, load)
        } else {
            load()
        }
    }

    /// 不经过缓存直接解码一个 Key Block。
    fn decode_key_block_uncached(&self, descriptor: &KeyBlock) -> Result<Arc<[u8]>> {
        block::decode(
            &descriptor.envelope,
            self.source.slice(descriptor.source),
            descriptor.decoded_size,
            self.crypto_key.as_slice(),
            self.path(),
            descriptor.source.start as u64,
            self.options.limits,
        )
    }

    /// 解码指定 Record Block，可选择随机 LRU 或顺序游标路径。
    pub(crate) fn decode_record_block(&self, index: usize, cache: bool) -> Result<Arc<[u8]>> {
        let descriptor = self.record_directory.blocks.get(index).ok_or_else(|| {
            Error::invalid(
                self.path(),
                0,
                format!("record block index {index} is out of range"),
            )
        })?;
        let load = || {
            block::decode(
                &descriptor.envelope,
                self.source.slice(descriptor.source),
                descriptor.decoded_size(),
                self.crypto_key.as_slice(),
                self.path(),
                descriptor.source.start as u64,
                self.options.limits,
            )
        };
        if cache {
            self.record_cache.get_or_try_insert(descriptor.id.0, load)
        } else {
            load()
        }
    }

    /// 二分定位包含给定逻辑 record offset 的 block。
    pub(crate) fn record_block_for_offset(&self, offset: u64, allow_end: bool) -> Result<usize> {
        self.record_directory
            .block_for_offset(offset, allow_end)
            .ok_or_else(|| {
                Error::invalid(self.path(), offset, "record offset is outside every block")
            })
    }

    /// 在公共 API 边界验证 record 范围并返回平台容量。
    pub(crate) fn validate_record_range(&self, start: u64, end: u64) -> Result<usize> {
        if end < start || end > self.record_directory.total_decoded_size {
            return Err(Error::invalid(
                self.path(),
                start,
                format!(
                    "record range {start}..{end} exceeds logical record size {}",
                    self.record_directory.total_decoded_size
                ),
            ));
        }
        let size = end - start;
        if size > self.options.limits.maximum_record_size {
            return Err(Error::LimitExceeded {
                name: "record size",
                actual: size,
                maximum: self.options.limits.maximum_record_size,
            });
        }
        usize::try_from(size).map_err(|_| Error::LimitExceeded {
            name: "record size",
            actual: size,
            maximum: usize::MAX as u64,
        })
    }
}

impl std::fmt::Debug for Mdict {
    /// 输出公开诊断信息，但不暴露注册凭据或派生密钥。
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Mdict")
            .field("path", &self.path())
            .field("metadata", &self.metadata)
            .field("options", &self.options)
            .finish_non_exhaustive()
    }
}
