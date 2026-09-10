use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use mdict::{
    Entry, FileKind, Key, KeyScanner, Limits, Mdd as CoreMdd, MddKey, MddList as CoreMddList,
    MddListEntryScanner as CoreMddListEntryScanner, MddListKeyScanner as CoreMddListKeyScanner,
    Mdict, Mdx as CoreMdx, OpenOptions as CoreOpenOptions,
};
use napi::bindgen_prelude::{AsyncTask, BigInt, Buffer};
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

const DEFAULT_BATCH_SIZE: u32 = 2_048;
const MAXIMUM_BATCH_SIZE: u32 = 100_000;
const FILE_HASH_CHUNK_SIZE: u64 = 64 * 1024;

/// 使用 XXH3-128 计算文件 checksum。小文件读取全部内容，大文件读取头、中、尾各 64 KiB。
#[napi(ts_return_type = "Promise<string>")]
pub fn hash_file(path: String) -> AsyncTask<HashFileTask> {
    AsyncTask::new(HashFileTask {
        path: PathBuf::from(path),
    })
}

pub struct HashFileTask {
    path: PathBuf,
}

impl Task for HashFileTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        sampled_file_checksum(&self.path).map_err(|error| Error::from_reason(error.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

fn sampled_file_checksum(path: &std::path::Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let file_size = file.metadata()?.len();
    let mut hasher = xxhash_rust::xxh3::Xxh3::new();
    hasher.update(&file_size.to_le_bytes());

    if file_size <= FILE_HASH_CHUNK_SIZE * 3 {
        let mut bytes = Vec::with_capacity(file_size as usize);
        file.read_to_end(&mut bytes)?;
        hasher.update(&bytes);
    } else {
        let offsets = [
            0,
            (file_size - FILE_HASH_CHUNK_SIZE) / 2,
            file_size - FILE_HASH_CHUNK_SIZE,
        ];
        let mut chunk = vec![0; FILE_HASH_CHUNK_SIZE as usize];
        for offset in offsets {
            file.seek(SeekFrom::Start(offset))?;
            file.read_exact(&mut chunk)?;
            hasher.update(&chunk);
        }
    }

    Ok(format!("{:032x}", hasher.digest128()))
}

/// Owns the binding's strong reference separately from the JavaScript wrapper lifetime.
///
/// Deleting a JS reference is not enough on Windows because garbage collection is
/// nondeterministic and the underlying memory mapping keeps the file locked. `close`
/// releases this reference as soon as no scanner or async task is using the dictionary.
struct CloseableDictionary<T> {
    value: Mutex<Option<Arc<T>>>,
}

impl<T> CloseableDictionary<T> {
    fn new(value: T) -> Self {
        Self {
            value: Mutex::new(Some(Arc::new(value))),
        }
    }

    fn get(&self) -> Result<Arc<T>> {
        self.value
            .lock()
            .map_err(|_| Error::from_reason("dictionary state lock is poisoned"))?
            .as_ref()
            .cloned()
            .ok_or_else(|| Error::from_reason("dictionary is closed"))
    }

    fn close(&self) -> Result<bool> {
        let mut value = self
            .value
            .lock()
            .map_err(|_| Error::from_reason("dictionary state lock is poisoned"))?;
        let Some(dictionary) = value.as_ref() else {
            return Ok(true);
        };
        if Arc::strong_count(dictionary) > 1 {
            return Ok(false);
        }
        value.take();
        Ok(true)
    }
}

/// Node-API 暴露的稳定元数据视图。
#[napi(object, object_from_js = false)]
pub struct DictionaryMetadata {
    pub path: String,
    pub kind: String,
    pub version: String,
    pub engine_version: f64,
    pub required_version: Option<f64>,
    pub encoding: String,
    pub encrypted: u32,
    pub title: String,
    pub description: String,
    pub format: String,
    pub key_case_sensitive: bool,
    pub strip_key: bool,
    pub attributes: HashMap<String, String>,
    pub warnings: Vec<String>,
    pub raw_header_xml: String,
    pub entry_count: u64,
    pub key_block_count: u64,
    pub record_block_count: u64,
    pub total_decompressed_record_size: u64,
    pub mapped_file_size: u64,
}

/// Node-API 打开选项。
#[napi(object, object_to_js = false)]
pub struct OpenOptions {
    pub maximum_header_size_bytes: Option<u32>,
    pub maximum_index_compressed_size_bytes: Option<u32>,
    pub maximum_index_decompressed_size_bytes: Option<u32>,
    pub maximum_block_compressed_size_bytes: Option<u32>,
    pub maximum_block_decompressed_size_bytes: Option<u32>,
    pub maximum_key_text_size_bytes: Option<u32>,
    pub maximum_record_size_bytes: Option<u32>,
    pub maximum_block_count: Option<u32>,
    pub maximum_mdd_volume_count: Option<u32>,
    pub key_blocks_cache_bytes: Option<u32>,
    pub record_blocks_cache_bytes: Option<u32>,
    pub user_id: Option<String>,
    pub reg_code: Option<String>,
    pub key_file: Option<String>,
}

/// 一个 MDX key 以及其 record 地址范围。
#[napi(object, object_from_js = false)]
pub struct DictionaryEntry {
    pub key_text: String,
    pub record_start: u64,
    pub record_end: u64,
}

/// 一个 MDD 列表 key 以及所在文件和 record 地址范围。
#[napi(object, object_from_js = false)]
pub struct MddListDictionaryEntry {
    pub key_text: String,
    pub volume: u32,
    pub record_start: u64,
    pub record_end: u64,
}

/// 一批 key 扫描结果。
#[napi(object, object_from_js = false)]
pub struct KeyBatch {
    pub entries: Vec<DictionaryEntry>,
    pub done: bool,
}

/// 一批 MDD 列表 key 扫描结果。
#[napi(object, object_from_js = false)]
pub struct MddListKeyBatch {
    pub entries: Vec<MddListDictionaryEntry>,
    pub done: bool,
}

/// 一条带原始 record bytes 的 entry。
#[napi(object, object_from_js = false)]
pub struct DictionaryRawEntry {
    pub key_text: String,
    pub data: Buffer,
}

/// 一批带原始 record bytes 的 entry。
#[napi(object, object_from_js = false)]
pub struct EntryBatch {
    pub entries: Vec<DictionaryRawEntry>,
    pub done: bool,
}

/// MDD 的二进制 lookup 结果。
#[napi(object, object_from_js = false)]
pub struct MddResource {
    pub key_text: String,
    pub data: Buffer,
}

/// 文本词典入口。除基础二进制读取外，还负责 LINK 和 StyleSheet 语义。
#[napi]
pub struct Mdx {
    dictionary: CloseableDictionary<CoreMdx>,
}

#[napi]
impl Mdx {
    /// 打开一份 MDX 文件。
    #[napi(factory)]
    pub fn open(path: String, options: Option<OpenOptions>) -> Result<Self> {
        CoreMdx::open_with_options(path, apply_options(options))
            .map(|dictionary| Self {
                dictionary: CloseableDictionary::new(dictionary),
            })
            .map_err(to_napi_error)
    }

    /// 返回词典元数据。
    #[napi(getter)]
    pub fn metadata(&self) -> Result<DictionaryMetadata> {
        Ok(metadata_from_mdict(self.dictionary.get()?.as_mdict()))
    }

    /// 创建顺序 key 批量扫描器。
    #[napi(ts_return_type = "MdxKeyScanner")]
    pub fn keys(&self) -> Result<MdxKeyScanner> {
        Ok(MdxKeyScanner {
            state: Arc::new(MdxKeyScannerState {
                dictionary: self.dictionary.get()?,
                scanner: Mutex::new(KeyScanner::new()),
                busy: AtomicBool::new(false),
            }),
        })
    }

    /// 创建顺序 key+record 批量扫描器。
    #[napi(ts_return_type = "MdxEntryScanner")]
    pub fn entries(&self) -> Result<MdxEntryScanner> {
        Ok(MdxEntryScanner {
            state: Arc::new(MdxEntryScannerState {
                dictionary: self.dictionary.get()?,
                scanner: Mutex::new(KeyScanner::new()),
                busy: AtomicBool::new(false),
            }),
        })
    }

    /// 读取一个可能跨越多个 Record Block 的原始 record。
    #[napi(ts_return_type = "Promise<Buffer>")]
    pub fn read_record(&self, start: BigInt, end: BigInt) -> Result<AsyncTask<ReadMdxRecordTask>> {
        Ok(AsyncTask::new(ReadMdxRecordTask {
            dictionary: self.dictionary.get()?,
            start: bigint_to_u64(start, "start")?,
            end: bigint_to_u64(end, "end")?,
        }))
    }

    /// 读取并解码 MDX record，可选展开 LINK 链和 StyleSheet。
    #[napi(ts_return_type = "Promise<string>")]
    pub fn read_record_text(
        &self,
        start: BigInt,
        end: BigInt,
        redirect_link: bool,
    ) -> Result<AsyncTask<ReadRecordTextTask>> {
        Ok(AsyncTask::new(ReadRecordTextTask {
            dictionary: self.dictionary.get()?,
            start: bigint_to_u64(start, "start")?,
            end: bigint_to_u64(end, "end")?,
            redirect_link,
        }))
    }

    /// 异步查找一个精确 key。
    #[napi(ts_return_type = "Promise<DictionaryEntry | null>")]
    pub fn find_key(&self, word: String) -> Result<AsyncTask<FindMdxKeyTask>> {
        Ok(AsyncTask::new(FindMdxKeyTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// 异步查找全部精确匹配 key，按 MDX 原始顺序返回。
    #[napi(ts_return_type = "Promise<DictionaryEntry[]>")]
    pub fn find_keys(&self, word: String) -> Result<AsyncTask<FindMdxKeysTask>> {
        Ok(AsyncTask::new(FindMdxKeysTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// 异步返回 comparison key 以指定前缀开头的全部 MDX key。
    #[napi(ts_return_type = "Promise<DictionaryEntry[]>")]
    pub fn prefix(&self, prefix: String, limit: Option<u32>) -> Result<AsyncTask<PrefixMdxTask>> {
        Ok(AsyncTask::new(PrefixMdxTask {
            dictionary: self.dictionary.get()?,
            prefix,
            limit: limit.map(|value| value as usize),
        }))
    }

    /// 查找 key 并返回解析后的 UTF-8 文本。
    #[napi(ts_return_type = "Promise<string | null>")]
    pub fn lookup_text(&self, word: String) -> Result<AsyncTask<LookupTextTask>> {
        Ok(AsyncTask::new(LookupTextTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// 查找全部精确匹配 key 并返回解析后的 UTF-8 文本。
    #[napi(ts_return_type = "Promise<string[]>")]
    pub fn lookup_all_text(&self, word: String) -> Result<AsyncTask<LookupAllTextTask>> {
        Ok(AsyncTask::new(LookupAllTextTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// Deterministically release the MDX memory mapping when it is no longer busy.
    #[napi]
    pub fn close(&self) -> Result<bool> {
        self.dictionary.close()
    }
}

/// 单个物理 MDD 二进制资源入口。
#[napi]
pub struct Mdd {
    dictionary: CloseableDictionary<CoreMdd>,
}

#[napi]
impl Mdd {
    /// 打开一份物理 MDD 文件。
    #[napi(factory)]
    pub fn open(path: String, options: Option<OpenOptions>) -> Result<Self> {
        CoreMdd::open_with_options(path, apply_options(options))
            .map(|dictionary| Self {
                dictionary: CloseableDictionary::new(dictionary),
            })
            .map_err(to_napi_error)
    }

    /// 返回该 MDD 文件的元数据。
    #[napi(getter)]
    pub fn metadata(&self) -> Result<DictionaryMetadata> {
        Ok(metadata_from_mdict(self.dictionary.get()?.as_mdict()))
    }

    /// 创建该文件的 key 批量扫描器。
    #[napi(ts_return_type = "MddKeyScanner")]
    pub fn keys(&self) -> Result<MddKeyScanner> {
        Ok(MddKeyScanner {
            state: Arc::new(MddKeyScannerState {
                dictionary: self.dictionary.get()?,
                scanner: Mutex::new(KeyScanner::new()),
                busy: AtomicBool::new(false),
            }),
        })
    }

    /// 创建该文件的 key+record 批量扫描器。
    #[napi(ts_return_type = "MddEntryScanner")]
    pub fn entries(&self) -> Result<MddEntryScanner> {
        Ok(MddEntryScanner {
            state: Arc::new(MddEntryScannerState {
                dictionary: self.dictionary.get()?,
                scanner: Mutex::new(KeyScanner::new()),
                busy: AtomicBool::new(false),
            }),
        })
    }

    /// 查找一个资源 key，并返回该文件内的 record 地址。
    #[napi(ts_return_type = "Promise<DictionaryEntry | null>")]
    pub fn find_key(&self, word: String) -> Result<AsyncTask<FindMddKeyTask>> {
        Ok(AsyncTask::new(FindMddKeyTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// 返回该文件中全部精确匹配的资源位置。
    #[napi(ts_return_type = "Promise<DictionaryEntry[]>")]
    pub fn find_keys(&self, word: String) -> Result<AsyncTask<FindMddKeysTask>> {
        Ok(AsyncTask::new(FindMddKeysTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// 异步返回该文件中以指定前缀开头的资源 key。
    #[napi(ts_return_type = "Promise<DictionaryEntry[]>")]
    pub fn prefix(&self, prefix: String) -> Result<AsyncTask<PrefixMddTask>> {
        Ok(AsyncTask::new(PrefixMddTask {
            dictionary: self.dictionary.get()?,
            prefix,
        }))
    }

    /// 读取该文件中的一个原始 record。
    #[napi(ts_return_type = "Promise<Buffer>")]
    pub fn read_record(&self, start: BigInt, end: BigInt) -> Result<AsyncTask<ReadMddRecordTask>> {
        Ok(AsyncTask::new(ReadMddRecordTask {
            dictionary: self.dictionary.get()?,
            start: bigint_to_u64(start, "start")?,
            end: bigint_to_u64(end, "end")?,
        }))
    }

    /// 查找并读取一个 MDD 二进制资源。
    #[napi(ts_return_type = "Promise<MddResource | null>")]
    pub fn lookup(&self, word: String) -> Result<AsyncTask<LookupMddTask>> {
        Ok(AsyncTask::new(LookupMddTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// Deterministically release the MDD memory mapping when it is no longer busy.
    #[napi]
    pub fn close(&self) -> Result<bool> {
        self.dictionary.close()
    }
}

/// 按调用方顺序查询多个物理 MDD 文件的资源列表入口。
#[napi]
pub struct MddList {
    dictionary: CloseableDictionary<CoreMddList>,
}

#[napi]
impl MddList {
    /// 按调用方提供的路径顺序打开 MDD 文件列表。
    #[napi(factory)]
    pub fn open(paths: Vec<String>, options: Option<OpenOptions>) -> Result<Self> {
        if paths.is_empty() {
            return Err(Error::new(Status::InvalidArg, "paths must not be empty"));
        }
        CoreMddList::open_with_options(paths, apply_options(options))
            .map(|dictionary| Self {
                dictionary: CloseableDictionary::new(dictionary),
            })
            .map_err(to_napi_error)
    }

    /// 返回列表包含的物理 MDD 文件数量。
    #[napi(getter)]
    pub fn volume_count(&self) -> Result<u32> {
        Ok(self.dictionary.get()?.volume_count() as u32)
    }

    /// 创建跨全部文件的 key 批量扫描器。
    #[napi(ts_return_type = "MddListKeyScanner")]
    pub fn keys(&self) -> Result<MddListKeyScanner> {
        let dictionary = self.dictionary.get()?;
        Ok(MddListKeyScanner {
            state: Arc::new(MddListKeyScannerState {
                scanner: Mutex::new(dictionary.key_scanner()),
                dictionary,
                busy: AtomicBool::new(false),
            }),
        })
    }

    /// 创建跨全部文件的 key+record 批量扫描器。
    #[napi(ts_return_type = "MddListEntryScanner")]
    pub fn entries(&self) -> Result<MddListEntryScanner> {
        let dictionary = self.dictionary.get()?;
        Ok(MddListEntryScanner {
            state: Arc::new(MddListEntryScannerState {
                scanner: Mutex::new(dictionary.entry_scanner()),
                dictionary,
                busy: AtomicBool::new(false),
            }),
        })
    }

    /// 查找一个资源 key，并返回所在文件和 record 地址。
    #[napi(ts_return_type = "Promise<MddListDictionaryEntry | null>")]
    pub fn find_key(&self, word: String) -> Result<AsyncTask<FindMddListKeyTask>> {
        Ok(AsyncTask::new(FindMddListKeyTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// 返回列表中全部精确匹配的资源位置。
    #[napi(ts_return_type = "Promise<MddListDictionaryEntry[]>")]
    pub fn find_keys(&self, word: String) -> Result<AsyncTask<FindMddListKeysTask>> {
        Ok(AsyncTask::new(FindMddListKeysTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// 返回全部文件中以指定前缀开头的资源 key。
    #[napi(ts_return_type = "Promise<MddListDictionaryEntry[]>")]
    pub fn prefix(&self, prefix: String) -> Result<AsyncTask<PrefixMddListTask>> {
        Ok(AsyncTask::new(PrefixMddListTask {
            dictionary: self.dictionary.get()?,
            prefix,
        }))
    }

    /// 读取指定文件中的一个原始 record。
    #[napi(ts_return_type = "Promise<Buffer>")]
    pub fn read_record(
        &self,
        volume: u32,
        start: BigInt,
        end: BigInt,
    ) -> Result<AsyncTask<ReadMddListRecordTask>> {
        Ok(AsyncTask::new(ReadMddListRecordTask {
            dictionary: self.dictionary.get()?,
            volume,
            start: bigint_to_u64(start, "start")?,
            end: bigint_to_u64(end, "end")?,
        }))
    }

    /// 按文件优先级查找并读取一个 MDD 二进制资源。
    #[napi(ts_return_type = "Promise<MddResource | null>")]
    pub fn lookup(&self, word: String) -> Result<AsyncTask<LookupMddListTask>> {
        Ok(AsyncTask::new(LookupMddListTask {
            dictionary: self.dictionary.get()?,
            word,
        }))
    }

    /// Deterministically release every MDD volume mapping when no operation is busy.
    #[napi]
    pub fn close(&self) -> Result<bool> {
        self.dictionary.close()
    }
}

struct MdxKeyScannerState {
    dictionary: Arc<CoreMdx>,
    scanner: Mutex<KeyScanner>,
    busy: AtomicBool,
}

struct MdxEntryScannerState {
    dictionary: Arc<CoreMdx>,
    scanner: Mutex<KeyScanner>,
    busy: AtomicBool,
}

struct MddKeyScannerState {
    dictionary: Arc<CoreMdd>,
    scanner: Mutex<KeyScanner>,
    busy: AtomicBool,
}

struct MddEntryScannerState {
    dictionary: Arc<CoreMdd>,
    scanner: Mutex<KeyScanner>,
    busy: AtomicBool,
}

struct MddListKeyScannerState {
    dictionary: Arc<CoreMddList>,
    scanner: Mutex<CoreMddListKeyScanner>,
    busy: AtomicBool,
}

struct MddListEntryScannerState {
    dictionary: Arc<CoreMddList>,
    scanner: Mutex<CoreMddListEntryScanner>,
    busy: AtomicBool,
}

/// MDX key 批量扫描器。
#[napi]
pub struct MdxKeyScanner {
    state: Arc<MdxKeyScannerState>,
}

/// MDX entry 批量扫描器。
#[napi]
pub struct MdxEntryScanner {
    state: Arc<MdxEntryScannerState>,
}

/// 单个 MDD 文件的 key 批量扫描器。
#[napi]
pub struct MddKeyScanner {
    state: Arc<MddKeyScannerState>,
}

/// 单个 MDD 文件的 entry 批量扫描器。
#[napi]
pub struct MddEntryScanner {
    state: Arc<MddEntryScannerState>,
}

/// MDD 文件列表的 key 批量扫描器。
#[napi]
pub struct MddListKeyScanner {
    state: Arc<MddListKeyScannerState>,
}

/// MDD 文件列表的 entry 批量扫描器。
#[napi]
pub struct MddListEntryScanner {
    state: Arc<MddListEntryScannerState>,
}

#[napi]
impl MdxKeyScanner {
    /// 读取下一批 MDX key。
    #[napi(ts_return_type = "Promise<KeyBatch>")]
    pub fn next_batch(&self, batch_size: Option<u32>) -> Result<AsyncTask<NextMdxKeysTask>> {
        let batch_size = validate_batch_size(batch_size)?;
        acquire_scanner(&self.state.busy)?;
        Ok(AsyncTask::new(NextMdxKeysTask {
            state: Arc::clone(&self.state),
            batch_size,
        }))
    }
}

#[napi]
impl MdxEntryScanner {
    /// 读取下一批 MDX key 与原始 record bytes。
    #[napi(ts_return_type = "Promise<EntryBatch>")]
    pub fn next_batch(&self, batch_size: Option<u32>) -> Result<AsyncTask<NextMdxEntriesTask>> {
        let batch_size = validate_batch_size(batch_size)?;
        acquire_scanner(&self.state.busy)?;
        Ok(AsyncTask::new(NextMdxEntriesTask {
            state: Arc::clone(&self.state),
            batch_size,
        }))
    }
}

#[napi]
impl MddKeyScanner {
    /// 读取下一批单文件 MDD key。
    #[napi(ts_return_type = "Promise<KeyBatch>")]
    pub fn next_batch(&self, batch_size: Option<u32>) -> Result<AsyncTask<NextMddKeysTask>> {
        let batch_size = validate_batch_size(batch_size)?;
        acquire_scanner(&self.state.busy)?;
        Ok(AsyncTask::new(NextMddKeysTask {
            state: Arc::clone(&self.state),
            batch_size,
        }))
    }
}

#[napi]
impl MddEntryScanner {
    /// 读取下一批单文件 MDD key 与原始资源 bytes。
    #[napi(ts_return_type = "Promise<EntryBatch>")]
    pub fn next_batch(&self, batch_size: Option<u32>) -> Result<AsyncTask<NextMddEntriesTask>> {
        let batch_size = validate_batch_size(batch_size)?;
        acquire_scanner(&self.state.busy)?;
        Ok(AsyncTask::new(NextMddEntriesTask {
            state: Arc::clone(&self.state),
            batch_size,
        }))
    }
}

#[napi]
impl MddListKeyScanner {
    /// 读取下一批跨文件 MDD key。
    #[napi(ts_return_type = "Promise<MddListKeyBatch>")]
    pub fn next_batch(&self, batch_size: Option<u32>) -> Result<AsyncTask<NextMddListKeysTask>> {
        let batch_size = validate_batch_size(batch_size)?;
        acquire_scanner(&self.state.busy)?;
        Ok(AsyncTask::new(NextMddListKeysTask {
            state: Arc::clone(&self.state),
            batch_size,
        }))
    }
}

#[napi]
impl MddListEntryScanner {
    /// 读取下一批跨文件 MDD key 与原始资源 bytes。
    #[napi(ts_return_type = "Promise<EntryBatch>")]
    pub fn next_batch(&self, batch_size: Option<u32>) -> Result<AsyncTask<NextMddListEntriesTask>> {
        let batch_size = validate_batch_size(batch_size)?;
        acquire_scanner(&self.state.busy)?;
        Ok(AsyncTask::new(NextMddListEntriesTask {
            state: Arc::clone(&self.state),
            batch_size,
        }))
    }
}

pub struct NextMdxKeysTask {
    state: Arc<MdxKeyScannerState>,
    batch_size: usize,
}

impl Drop for NextMdxKeysTask {
    fn drop(&mut self) {
        self.state.busy.store(false, Ordering::Release);
    }
}

impl Task for NextMdxKeysTask {
    type Output = KeyBatch;
    type JsValue = KeyBatch;

    fn compute(&mut self) -> Result<Self::Output> {
        let result = (|| {
            let mut scanner = self
                .state
                .scanner
                .lock()
                .map_err(|_| Error::from_reason("key scanner lock is poisoned"))?;
            let entries = scanner
                .next_batch(self.state.dictionary.as_mdict(), self.batch_size)
                .map_err(to_napi_error)?;
            Ok(KeyBatch {
                entries: entries.into_iter().map(DictionaryEntry::from).collect(),
                done: scanner.is_finished(),
            })
        })();
        self.state.busy.store(false, Ordering::Release);
        result
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct NextMdxEntriesTask {
    state: Arc<MdxEntryScannerState>,
    batch_size: usize,
}

impl Drop for NextMdxEntriesTask {
    fn drop(&mut self) {
        self.state.busy.store(false, Ordering::Release);
    }
}

impl Task for NextMdxEntriesTask {
    type Output = EntryBatch;
    type JsValue = EntryBatch;

    fn compute(&mut self) -> Result<Self::Output> {
        let result = (|| {
            let mut scanner = self
                .state
                .scanner
                .lock()
                .map_err(|_| Error::from_reason("entry scanner lock is poisoned"))?;
            let keys = scanner
                .next_batch(self.state.dictionary.as_mdict(), self.batch_size)
                .map_err(to_napi_error)?;
            let done = scanner.is_finished();
            let entries = keys
                .into_iter()
                .map(|key| {
                    self.state
                        .dictionary
                        .as_mdict()
                        .read_record(key.record_start, key.record_end)
                        .map(|data| DictionaryRawEntry {
                            key_text: key.text,
                            data: data.into(),
                        })
                        .map_err(to_napi_error)
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(EntryBatch { entries, done })
        })();
        self.state.busy.store(false, Ordering::Release);
        result
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct NextMddKeysTask {
    state: Arc<MddKeyScannerState>,
    batch_size: usize,
}

impl Drop for NextMddKeysTask {
    fn drop(&mut self) {
        self.state.busy.store(false, Ordering::Release);
    }
}

impl Task for NextMddKeysTask {
    type Output = KeyBatch;
    type JsValue = KeyBatch;

    fn compute(&mut self) -> Result<Self::Output> {
        let result = (|| {
            let mut scanner = self
                .state
                .scanner
                .lock()
                .map_err(|_| Error::from_reason("MDD key scanner lock is poisoned"))?;
            let entries = scanner
                .next_batch(self.state.dictionary.as_mdict(), self.batch_size)
                .map_err(to_napi_error)?;
            Ok(KeyBatch {
                entries: entries.into_iter().map(DictionaryEntry::from).collect(),
                done: scanner.is_finished(),
            })
        })();
        self.state.busy.store(false, Ordering::Release);
        result
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct NextMddEntriesTask {
    state: Arc<MddEntryScannerState>,
    batch_size: usize,
}

impl Drop for NextMddEntriesTask {
    fn drop(&mut self) {
        self.state.busy.store(false, Ordering::Release);
    }
}

impl Task for NextMddEntriesTask {
    type Output = EntryBatch;
    type JsValue = EntryBatch;

    fn compute(&mut self) -> Result<Self::Output> {
        let result = (|| {
            let mut scanner = self
                .state
                .scanner
                .lock()
                .map_err(|_| Error::from_reason("MDD entry scanner lock is poisoned"))?;
            let keys = scanner
                .next_batch(self.state.dictionary.as_mdict(), self.batch_size)
                .map_err(to_napi_error)?;
            let done = scanner.is_finished();
            let entries = keys
                .into_iter()
                .map(|key| {
                    self.state
                        .dictionary
                        .read_record(key.record_start, key.record_end)
                        .map(|data| DictionaryRawEntry {
                            key_text: key.text,
                            data: data.into(),
                        })
                        .map_err(to_napi_error)
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(EntryBatch { entries, done })
        })();
        self.state.busy.store(false, Ordering::Release);
        result
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct NextMddListKeysTask {
    state: Arc<MddListKeyScannerState>,
    batch_size: usize,
}

impl Drop for NextMddListKeysTask {
    fn drop(&mut self) {
        self.state.busy.store(false, Ordering::Release);
    }
}

impl Task for NextMddListKeysTask {
    type Output = MddListKeyBatch;
    type JsValue = MddListKeyBatch;

    fn compute(&mut self) -> Result<Self::Output> {
        let result = (|| {
            let mut scanner = self
                .state
                .scanner
                .lock()
                .map_err(|_| Error::from_reason("MDD list key scanner lock is poisoned"))?;
            let entries = scanner
                .next_batch(&self.state.dictionary, self.batch_size)
                .map_err(to_napi_error)?;
            Ok(MddListKeyBatch {
                entries: entries
                    .into_iter()
                    .map(MddListDictionaryEntry::from)
                    .collect(),
                done: scanner.is_finished(),
            })
        })();
        self.state.busy.store(false, Ordering::Release);
        result
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct NextMddListEntriesTask {
    state: Arc<MddListEntryScannerState>,
    batch_size: usize,
}

impl Drop for NextMddListEntriesTask {
    fn drop(&mut self) {
        self.state.busy.store(false, Ordering::Release);
    }
}

impl Task for NextMddListEntriesTask {
    type Output = EntryBatch;
    type JsValue = EntryBatch;

    fn compute(&mut self) -> Result<Self::Output> {
        let result = (|| {
            let mut scanner = self
                .state
                .scanner
                .lock()
                .map_err(|_| Error::from_reason("MDD list entry scanner lock is poisoned"))?;
            let entries = scanner
                .next_batch(&self.state.dictionary, self.batch_size)
                .map_err(to_napi_error)?;
            Ok(EntryBatch {
                entries: entries
                    .into_iter()
                    .map(|entry| DictionaryRawEntry {
                        key_text: entry.key,
                        data: entry.data.into(),
                    })
                    .collect(),
                done: scanner.is_finished(),
            })
        })();
        self.state.busy.store(false, Ordering::Release);
        result
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct ReadMdxRecordTask {
    dictionary: Arc<CoreMdx>,
    start: u64,
    end: u64,
}

impl Task for ReadMdxRecordTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary
            .as_mdict()
            .read_record(self.start, self.end)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

pub struct ReadMddRecordTask {
    dictionary: Arc<CoreMdd>,
    start: u64,
    end: u64,
}

impl Task for ReadMddRecordTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary
            .read_record(self.start, self.end)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

pub struct ReadMddListRecordTask {
    dictionary: Arc<CoreMddList>,
    volume: u32,
    start: u64,
    end: u64,
}

impl Task for ReadMddListRecordTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary
            .read_record(self.volume, self.start, self.end)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

pub struct ReadRecordTextTask {
    dictionary: Arc<CoreMdx>,
    start: u64,
    end: u64,
    redirect_link: bool,
}

impl Task for ReadRecordTextTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary
            .read_record_text(self.start, self.end, self.redirect_link)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct FindMdxKeyTask {
    dictionary: Arc<CoreMdx>,
    word: String,
}

impl Task for FindMdxKeyTask {
    type Output = Option<Key>;
    type JsValue = Option<DictionaryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary.find_key(&self.word).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(DictionaryEntry::from))
    }
}

pub struct FindMdxKeysTask {
    dictionary: Arc<CoreMdx>,
    word: String,
}

impl Task for FindMdxKeysTask {
    type Output = Vec<Key>;
    type JsValue = Vec<DictionaryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary.find_keys(&self.word).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(DictionaryEntry::from).collect())
    }
}

pub struct PrefixMdxTask {
    dictionary: Arc<CoreMdx>,
    prefix: String,
    limit: Option<usize>,
}

impl Task for PrefixMdxTask {
    type Output = Vec<Key>;
    type JsValue = Vec<DictionaryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary
            .prefix(&self.prefix)
            .map_err(to_napi_error)?
            .take(self.limit.unwrap_or(usize::MAX))
            .collect::<mdict::Result<Vec<_>>>()
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(DictionaryEntry::from).collect())
    }
}

pub struct LookupTextTask {
    dictionary: Arc<CoreMdx>,
    word: String,
}

impl Task for LookupTextTask {
    type Output = Option<String>;
    type JsValue = Option<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary
            .lookup_text(&self.word)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct LookupAllTextTask {
    dictionary: Arc<CoreMdx>,
    word: String,
}

impl Task for LookupAllTextTask {
    type Output = Vec<String>;
    type JsValue = Vec<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary
            .lookup_all_text(&self.word)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct FindMddKeyTask {
    dictionary: Arc<CoreMdd>,
    word: String,
}

impl Task for FindMddKeyTask {
    type Output = Option<Key>;
    type JsValue = Option<DictionaryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary.find_key(&self.word).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(DictionaryEntry::from))
    }
}

pub struct FindMddKeysTask {
    dictionary: Arc<CoreMdd>,
    word: String,
}

impl Task for FindMddKeysTask {
    type Output = Vec<Key>;
    type JsValue = Vec<DictionaryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary.find_keys(&self.word).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(DictionaryEntry::from).collect())
    }
}

pub struct PrefixMddTask {
    dictionary: Arc<CoreMdd>,
    prefix: String,
}

impl Task for PrefixMddTask {
    type Output = Vec<Key>;
    type JsValue = Vec<DictionaryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary
            .prefix(&self.prefix)
            .map_err(to_napi_error)?
            .collect::<mdict::Result<Vec<_>>>()
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(DictionaryEntry::from).collect())
    }
}

pub struct FindMddListKeyTask {
    dictionary: Arc<CoreMddList>,
    word: String,
}

impl Task for FindMddListKeyTask {
    type Output = Option<MddKey>;
    type JsValue = Option<MddListDictionaryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary.find_key(&self.word).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(MddListDictionaryEntry::from))
    }
}

pub struct FindMddListKeysTask {
    dictionary: Arc<CoreMddList>,
    word: String,
}

impl Task for FindMddListKeysTask {
    type Output = Vec<MddKey>;
    type JsValue = Vec<MddListDictionaryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary.find_keys(&self.word).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output
            .into_iter()
            .map(MddListDictionaryEntry::from)
            .collect())
    }
}

pub struct PrefixMddListTask {
    dictionary: Arc<CoreMddList>,
    prefix: String,
}

impl Task for PrefixMddListTask {
    type Output = Vec<MddKey>;
    type JsValue = Vec<MddListDictionaryEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary
            .prefix(&self.prefix)
            .map_err(to_napi_error)?
            .collect::<mdict::Result<Vec<_>>>()
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output
            .into_iter()
            .map(MddListDictionaryEntry::from)
            .collect())
    }
}

pub struct LookupMddListTask {
    dictionary: Arc<CoreMddList>,
    word: String,
}

impl Task for LookupMddListTask {
    type Output = Option<Entry>;
    type JsValue = Option<MddResource>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary.lookup(&self.word).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(|resource| MddResource {
            key_text: resource.key,
            data: resource.data.into(),
        }))
    }
}

pub struct LookupMddTask {
    dictionary: Arc<CoreMdd>,
    word: String,
}

impl Task for LookupMddTask {
    type Output = Option<Entry>;
    type JsValue = Option<MddResource>;

    fn compute(&mut self) -> Result<Self::Output> {
        self.dictionary.lookup(&self.word).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(|resource| MddResource {
            key_text: resource.key,
            data: resource.data.into(),
        }))
    }
}

impl From<Key> for DictionaryEntry {
    fn from(key: Key) -> Self {
        Self {
            key_text: key.text,
            record_start: key.record_start,
            record_end: key.record_end,
        }
    }
}

impl From<MddKey> for MddListDictionaryEntry {
    fn from(key: MddKey) -> Self {
        Self {
            key_text: key.text,
            volume: key.volume,
            record_start: key.record_start,
            record_end: key.record_end,
        }
    }
}

fn metadata_from_mdict(dictionary: &Mdict) -> DictionaryMetadata {
    let metadata = dictionary.metadata();
    metadata_view(
        dictionary.path().to_string_lossy().into_owned(),
        metadata,
        dictionary.encryption_flags(),
        dictionary.record_size(),
    )
}

fn metadata_view(
    path: String,
    metadata: &mdict::Metadata,
    encryption_flags: u8,
    record_size: u64,
) -> DictionaryMetadata {
    let attributes: HashMap<String, String> = metadata
        .attributes
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    DictionaryMetadata {
        path: path.clone(),
        kind: match metadata.kind {
            FileKind::Mdx => "mdx",
            FileKind::Mdd => "mdd",
        }
        .to_owned(),
        version: format!("{:?}", metadata.version).to_lowercase(),
        engine_version: metadata.engine_version.parse().unwrap_or_default(),
        required_version: attribute(&metadata.attributes, "RequiredEngineVersion")
            .or_else(|| attribute(&metadata.attributes, "RequiredVersion"))
            .and_then(|value| value.parse().ok()),
        encoding: metadata.encoding.clone(),
        encrypted: u32::from(encryption_flags),
        title: metadata.title.clone(),
        description: metadata.description.clone(),
        format: metadata.format.clone(),
        key_case_sensitive: attribute(&metadata.attributes, "KeyCaseSensitive")
            .is_some_and(parse_bool),
        strip_key: attribute(&metadata.attributes, "StripKey").is_some_and(parse_bool),
        attributes,
        warnings: metadata
            .warnings
            .iter()
            .map(|warning| warning.message.clone())
            .collect(),
        raw_header_xml: metadata.raw_header.clone(),
        entry_count: metadata.entry_count,
        key_block_count: metadata.key_block_count,
        record_block_count: metadata.record_block_count,
        total_decompressed_record_size: record_size,
        mapped_file_size: std::fs::metadata(path)
            .map(|value| value.len())
            .unwrap_or_default(),
    }
}

fn validate_batch_size(batch_size: Option<u32>) -> Result<usize> {
    let batch_size = batch_size.unwrap_or(DEFAULT_BATCH_SIZE);
    if batch_size == 0 || batch_size > MAXIMUM_BATCH_SIZE {
        return Err(Error::new(
            Status::InvalidArg,
            format!("batchSize must be between 1 and {MAXIMUM_BATCH_SIZE}"),
        ));
    }
    Ok(batch_size as usize)
}

fn acquire_scanner(busy: &AtomicBool) -> Result<()> {
    if busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(Error::new(
            Status::GenericFailure,
            "nextBatch is already running for this scanner",
        ));
    }
    Ok(())
}

/// 将 Node 打开的选项映射到核心限制、缓存和加密凭据。
fn apply_options(options: Option<OpenOptions>) -> CoreOpenOptions {
    let Some(options) = options else {
        return CoreOpenOptions::default();
    };
    let mut limits = Limits::default();
    assign_u32(
        &mut limits.maximum_header_size,
        options.maximum_header_size_bytes,
    );
    assign_u32(
        &mut limits.maximum_index_decompressed_size,
        options.maximum_index_decompressed_size_bytes,
    );
    assign_u32(
        &mut limits.maximum_block_decompressed_size,
        options.maximum_block_decompressed_size_bytes,
    );
    assign_u32(
        &mut limits.maximum_record_size,
        options.maximum_record_size_bytes,
    );
    assign_u32(&mut limits.maximum_block_count, options.maximum_block_count);
    assign_u32(
        &mut limits.maximum_mdd_volume_count,
        options.maximum_mdd_volume_count,
    );
    let mut core = CoreOpenOptions {
        limits,
        ..CoreOpenOptions::default()
    };
    if let Some(value) = options.key_blocks_cache_bytes {
        core.cache.key_blocks_bytes = value as usize;
    }
    if let Some(value) = options.record_blocks_cache_bytes {
        core.cache.record_blocks_bytes = value as usize;
    }
    core.credentials.user_id = options.user_id;
    core.credentials.reg_code = options.reg_code;
    core.credentials.key_file = options.key_file.map(PathBuf::from);
    core
}

fn assign_u32(target: &mut u64, value: Option<u32>) {
    if let Some(value) = value {
        *target = u64::from(value);
    }
}

fn attribute<'a>(
    attributes: &'a std::collections::BTreeMap<String, String>,
    name: &str,
) -> Option<&'a str> {
    attributes
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "yes" | "true" | "1"
    )
}

fn bigint_to_u64(value: BigInt, label: &str) -> Result<u64> {
    let (negative, value, lossless) = value.get_u64();
    if negative || !lossless {
        Err(Error::new(
            Status::InvalidArg,
            format!("{label} must be a non-negative bigint within the u64 range"),
        ))
    } else {
        Ok(value)
    }
}

fn to_napi_error(error: mdict::Error) -> Error {
    Error::from_reason(error.to_string())
}
