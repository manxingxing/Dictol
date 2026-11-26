# DIDX v3：通用词头索引

本文件描述当前且唯一受支持的 v3 实现。项目尚未发布，不保留更早试验格式的布局文档或兼容读取逻辑。

## 实现范围

- `native/mdict/src/index.rs` 是格式无关的 builder/reader。`IndexSource` 提供可重复枚举的原始词条、适配器私有 locator 字节和来源指纹。
- `mdx_index.rs` 是当前唯一适配器。它枚举 MDX key，将逻辑正文起点和长度编码为两个 unsigned LEB128；查词不依赖 MDX 原生词头二分查找。
- Node 的 DIDX 查询、校验、构建和带来源校验的打开均异步执行。`exact()` 不默认截断物理记录；候选类 API 默认 50，最多 10,000。
- `DidxQueryService` 在调用方提供的已启用词典中并行查询，候选全局排序、按大小写不敏感键去重，并保留 `dictionaryIds`。释义精确命中将同一查询返回的多个 physical record 按顺序读取并合并。
- 当前应用接入的三条词典 API 是：每部词典最多 50 个候选并归并为 50 个最终结果；精确命中返回命中的词典；按精确定位并行读取释义。应用查询路径暂不使用 ECDICT。
- `DidxImportService.rebuild(id)` 用于迁移和手动重建，沿用词典 UUID，不修改词典原文件、生词本和笔记。Rust 发布索引前完成完整校验，服务不再重复打开并校验索引。

数据库升级分为两步：`0011_dictionary_uuid.sql` 添加 UUID 列和唯一索引；旧的复制导入词典复用 `dict_path` 最后一级目录中的 UUID，external 词典生成新的 UUID v4。`0012_dictionary_index_and_groups.sql` 添加 DIDX 状态表和词典组表。历史 `dictionary_entry` 本次保留，仅在对应词典成功建立 DIDX 后清理记录。

当前 MDX 导入 Worker 已直接构建 UUID 目录下的 DIDX，不再写入 `dictionary_entry`；主进程通过 `AppRuntime.dictionaryIndexManager` 懒加载索引。生词本和笔记不受影响。StarDict、Lingoes、macOS 词典适配器仍未实现，也不实现全文搜索、正则、英美拼写词库或繁简转换。没有复制 GoldenDict-ng 代码，未修改项目许可证；不宣称达到其全部功能或性能。

## 查询语义

| API / 标签                 | 规则                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| exact / `exact`            | trim + NFC 后原始拼写相等，排在最前；所有物理记录保留                                               |
| exact / `case-insensitive` | Unicode full case folding 相等，不混入去重音、去标点结果                                            |
| loose / `loose`            | case folding 后 NFKD，移除空白、组合标记、Unicode 标点；与精确结果分组返回                          |
| prefix / `prefix`          | 归一化词头前缀，每个归一化词组选最贴近输入的原始拼写代表                                            |
| fuzzy / `fuzzy`            | 归一化后的 Unicode scalar Levenshtein，返回 distance；共享前缀 DP、剪枝、有界 Top-K                 |
| wildcard / `wildcard`      | 对 case folding 后的完整词头匹配，保留标点和重音；`?` 一个 scalar，`*` 零到多个；反斜线转义字面字符 |

`cafe` 的精确组不会含 `café`，后者在 loose 组；NFC 等价的预组合/分解拼写属于精确组。标点本身构成的词条保留可检索键。full case folding 可能展开字符（如 ß → ss），因此通配符 `?` 按展开后的 scalar 计数，不按用户感知字素计数。

候选优先级：exact、case-insensitive、loose、prefix、fuzzy。先给正常候选，数量不足时补拼写建议；长度不超过四个归一化 scalar 时距离 1，否则 2。显式 fuzzy 最大距离 4，fuzzy/wildcard 输入最多 256 scalar；更长的普通词头仍可精确/前缀查询。原始 key 最多 65,536 字节，locator 为 1–4,096 字节。

通配符按字面前缀缩小扫描范围；前导 `*` 等没有有效前缀的模式可能扫描全部词头。当前没有后缀索引或查询取消 API，大词典上的最坏延迟仍需后续测量。

## 二进制布局

格式版本 3，归一化版本 2。固定字段小端，变长整数 unsigned LEB128；布局继续使用 mmap、稀疏块目录、每块最多 32 个归一化词头与 front coding，没有移植 B-tree。

96 字节 header：magic 0–7；格式 8–11；header 长度 12–15；保留零 16–19；归一化版本 20–23；term/entry/block 数量分别在 24/32/40；目录 offset/length 在 48/56；块容量 64；保留零 68；目录 xxHash64 在 72；来源指纹 80；前 88 字节的 xxHash64 在 88。

块开头保存 base ordinal。每个 term 保存前缀压缩词头及 posting 数据，每个 posting 保存 ordinal 差值、locator 长度及字节、原始拼写的差异编码。MDX 正文位置的解释已移出该布局。目录保存块范围、首词和校验值；读取时检查边界，`validate()` 扫描全部块与 posting。

来源指纹由适配器负责包含内容与 locator 编码版本；MDX 使用文件大小及头、中、尾各 64 KiB 样本的 xxHash64，seed `0x4d445801`。它是快速过期检测，不是安全签名，可能漏掉未落在样本中的内容变化。低层 `open(path)` 不检查来源；应用查询使用 `openForMdx` 的来源/header/目录校验，构建和维护任务再显式执行全量 `validate()`。

构建先独占创建 `index.didx.tmp`，写完 flush/sync、完整校验、复核来源指纹，再替换正式文件。失败仅清理本次创建的临时文件，已有正式索引不受构建失败影响；他人的临时文件不删除。非 v3 文件直接拒绝并由服务重建，不维护兼容解码分支。词典在 reader 打开期间不应被原地写入或截断（mmap 使用约束）。

## 本机验证（2026-09-11）

OALDPE，源文件 58,072,934 字节；622,808 个物理词条、388,958 个归一化词组。逐条核对原始拼写、ordinal 和解码后的正文地址全部通过。

一次 release 测量：索引 13,283,926 字节；构建 3,256.46 ms；低层打开 1.66 ms（不含来源 hash 或全量校验）；精确查询 P50/P95 14.72/30.83 μs；前缀 P50/P95 164.67/252.50 μs；五个 fuzzy 样本 P50/最大 21.25/23.32 ms。这不是冷缓存、多词典或跨平台保证，也未与 GoldenDict-ng 同条件对比。

复现：`cargo run --release --manifest-path native/mdict/Cargo.toml --example didx_bench -- SOURCE.mdx OUTPUT.didx --verify`，输出应放临时目录，不能覆盖词典原文件。

回归命令（Node 测试前先 `npm run native:build`）：

```sh
cargo test --manifest-path native/mdict/Cargo.toml --offline
node --test tests/native/mdict/binding.test.mjs scripts/didx-index.test.mjs
node --import tsx --test scripts/didx-query-service.test.ts scripts/word-form-service.test.ts scripts/didx-import-service.test.ts scripts/didx-search-integration.test.ts scripts/didx-schema-upgrade.test.ts
npm run typecheck:node
```

测试使用临时数据库与临时索引，只读仓库内 OALDPE 和 ECDICT。没有操作用户实际应用数据库；没有验证 Windows/Linux 打包或 Electron 界面行为。
