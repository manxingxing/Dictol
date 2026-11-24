use std::path::PathBuf;

/// Resource limits for values that can otherwise cause unbounded allocation.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Header XML 允许的最大字节数。
    pub maximum_header_size: u64,
    /// 单个解压后索引允许的最大字节数。
    pub maximum_index_decompressed_size: u64,
    /// 单个解压后数据 block 允许的最大字节数。
    pub maximum_block_decompressed_size: u64,
    /// 一次公开 record 读取允许的最大字节数。
    pub maximum_record_size: u64,
    /// 单个 section 或 Unit 允许声明的最大 block 数量。
    pub maximum_block_count: u64,
    /// 一组 MDD 允许调用方提供的最大分卷数量。
    pub maximum_mdd_volume_count: u64,
}

impl Default for Limits {
    /// 返回适合桌面词典应用的保守资源上限。
    fn default() -> Self {
        Self {
            maximum_header_size: 16 * 1024 * 1024,
            maximum_index_decompressed_size: 256 * 1024 * 1024,
            maximum_block_decompressed_size: 256 * 1024 * 1024,
            maximum_record_size: 256 * 1024 * 1024,
            maximum_block_count: 1_000_000,
            maximum_mdd_volume_count: 10_000,
        }
    }
}

/// Random-access cache capacities, measured in decoded bytes.
#[derive(Debug, Clone, Copy)]
pub struct CacheOptions {
    /// 随机查询 Key Block 缓存的解压后字节容量。
    pub key_blocks_bytes: usize,
    /// 随机查询 Record Block 缓存的解压后字节容量。
    pub record_blocks_bytes: usize,
}

impl Default for CacheOptions {
    /// 返回默认的 Key Block 与 Record Block 缓存容量。
    fn default() -> Self {
        Self {
            key_blocks_bytes: 3 * 1024 * 1024,
            record_blocks_bytes: 5 * 1024 * 1024,
        }
    }
}

/// Optional registration credentials for encrypted v1/v2 dictionaries.
#[derive(Clone, Default, zeroize::Zeroize, zeroize::ZeroizeOnDrop)]
pub struct Credentials {
    /// 注册使用的原始 Email 或 Device ID。
    pub user_id: Option<String>,
    /// 十六进制编码的注册代码；优先于 `.key` 和 Header。
    pub reg_code: Option<String>,
    /// 覆盖默认的同名 `.key` 文件路径。
    #[zeroize(skip)]
    pub key_file: Option<PathBuf>,
}

impl std::fmt::Debug for Credentials {
    /// 输出配置结构，同时隐藏用户标识和注册码内容。
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Credentials")
            .field("user_id", &self.user_id.as_ref().map(|_| "<redacted>"))
            .field("reg_code", &self.reg_code.as_ref().map(|_| "<redacted>"))
            .field("key_file", &self.key_file)
            .finish()
    }
}

/// Options applied while opening an MDict file.
#[derive(Debug, Clone, Default)]
pub struct OpenOptions {
    /// 解析和解压使用的资源上限。
    pub limits: Limits,
    /// 随机查询 block 缓存容量。
    pub cache: CacheOptions,
    /// 可选的 v1/v2 注册凭据。
    pub credentials: Credentials,
}
