# mdict

`mdict` 是一个只读的 Rust MDict 解析库，面向 MDX 文本词典和 MDD 二进制资源。
它以 mmap 读取文件，支持 v1、v2、v3，并把版本专属的 Section、Unit 和 Block
布局隐藏在统一 API 后面。

当前 crate 同时提供：

- `Mdict`：单个物理 MDX/MDD 文件的 key、record、查询和遍历；
- `Mdx`：在 `Mdict` 之上增加文本解码、`@@@LINK=` 和 StyleSheet 展开；
- `Mdd`：读取一份物理 MDD 文件；
- `MddList`：按调用方给定的路径顺序查询多份 MDD 文件；
- `mdict`：与 library 一起构建的检查和提取命令行工具。

## Node 绑定

同一目录下的 `package.json`、`build.mjs` 和 `prebuilds/` 提供
`@dictol/mdict-native`。`src/binding.rs` 包含 MDict、DIDX、LD2 和文件哈希
的 N-API 绑定；`node` feature 启用绑定，默认 Rust 库和 CLI 构建不依赖 Node 运行时。
启用 `node` feature 需要 Rust 1.88 或更高版本。

```bash
npm --prefix native/mdict run build
npm run native:test
# 纯 Rust CLI
cargo run --manifest-path native/mdict/Cargo.toml -- --help
```

Node 包从 `wrapper.js` 加载当前平台的预构建文件，类型声明为 `index.d.ts`，
renderer 通过主进程 IPC 使用词典能力。

## Rust API

打开 MDX 并查词：

```rust,no_run
use mdict::{Mdx, Result};

fn main() -> Result<()> {
    let dictionary = Mdx::open("dictionary.mdx")?;

    if let Some(key) = dictionary.find_key("example")? {
        println!("{}: {}..{}", key.text, key.record_start, key.record_end);
    }

    if let Some(html) = dictionary.lookup_text("example")? {
        println!("{html}");
    }

    // 一个 key 可对应多个 record，例如主词条与独立的附图 record。
    for html in dictionary.lookup_all_text("example")? {
        println!("{html}");
    }
    Ok(())
}
```

流式遍历 key 或 key + record：

```rust,no_run
use mdict::{Mdict, Result};

fn main() -> Result<()> {
    let dictionary = Mdict::open("dictionary.mdx")?;

    for key in dictionary.keys() {
        let key = key?;
        println!("{}\t{}\t{}", key.text, key.record_start, key.record_end);
    }

    for entry in dictionary.entries() {
        let entry = entry?;
        println!("{}: {} bytes", entry.key, entry.data.len());
    }
    Ok(())
}
```

查找 MDD 资源时，显式传入参与查询的分卷路径：

```rust,no_run
use mdict::{MddList, Result};

fn main() -> Result<()> {
    let resources = MddList::open(vec![
        "dictionary.mdd",
        "dictionary.1.mdd",
        "dictionary.2.mdd",
    ])?;
    if let Some(resource) = resources.lookup("/images/logo.png")? {
        std::fs::write("logo.png", resource.data).expect("write extracted resource");
    }
    Ok(())
}
```

`keys()` 和 `entries()` 都是流式迭代器。`entries()` 使用独立的顺序 Record Block
游标，不会对每个词条重复执行随机定位，也不会污染随机查词使用的 LRU。

## 加密词典

v3 密钥根据 Header UUID 自动派生。v2 注册词典通过 `OpenOptions` 提供原始
`user_id` 和十六进制 `reg_code`：

```rust,no_run
use mdict::{Credentials, Mdict, OpenOptions, Result};

fn main() -> Result<()> {
    let options = OpenOptions {
        credentials: Credentials {
            user_id: Some("reader@example.com".into()),
            reg_code: Some("00112233445566778899aabbccddeeff".into()),
            key_file: None,
        },
        ..OpenOptions::default()
    };
    let dictionary = Mdict::open_with_options("registered.mdx", options)?;
    println!("{} entries", dictionary.metadata().entry_count);
    Ok(())
}
```

未显式传入 `reg_code` 时，库会依次尝试同名 `.key` 文件和 Header 内嵌值。凭据
不会出现在 `Debug` 输出中，并在离开作用域时清零。

## CLI

```text
mdict -h, --header file.mdx       打印 Header XML
mdict --keys file.mdx             列出全部 key 和逻辑 record 范围
mdict -k, --key <key> file.mdx    查询首个 key 的逻辑位置
mdict -K, --all-key <key> file.mdx 查询全部精确匹配 key 的逻辑位置
mdict -l, --lookup <key> file.mdx 输出首条完成 LINK/StyleSheet 处理的 UTF-8 文本
mdict -L, --lookup-all <key> file.mdx 输出全部精确匹配的处理后文本
mdict -p <prefix> file.mdx    前缀查询
mdict --prefix <prefix> file.mdx
mdict -x, --extract <key> file.mdd 将二进制资源原样写入 stdout
mdict --help                  显示帮助
```

构建、测试和生成 API 文档：

```bash
cargo build --release
cargo test
cargo test --test real_dictionaries -- --ignored
cargo doc --no-deps --open
```

第三条命令需要仓库 `Dictionaries/` 目录中的真实测试词典。

## 格式与兼容性

- v1 通过 v2 parser 的兼容分支读取，v2 使用同一套布局，v3 使用四 Unit 布局；
- 支持 None、LZO、zlib、LZMA、bzip2、LZ4；
- v2 支持 Key Section 参数加密、Key Block Index 加密和注册密钥 block；
- v3 支持 UUID 双 XXH64 大端密钥、simple encryption 和 Salsa20/8；
- record 可以横跨多个 Record Block；重复 key 和相同 record offset 不会被去重；
- MDD 支持调用方显式传入编号不连续的数字分卷，但拒绝混合格式版本。

v1/v3 的格式细节以 `raymanzhang/mdx` commit
`111cab6cddb119ce35158ee1a8d641bab698c87e` 为兼容基线。当前 v3 状态是
reference-compatible，尚未用官方 MDict v3 文件交叉验证。

完整架构、错误边界和测试决策见 [docs/design.md](docs/design.md)。

## 范围

核心 crate 不包含 N-API、SQLite、FST/FTS、持久化 `.locations` 索引、HTML DOM
改写或 MIME 推断。这些能力应建立在 `keys()`、`entries()`、`lookup()` 和
`read_record()` 之上。
