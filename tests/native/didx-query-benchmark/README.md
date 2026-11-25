# DIDX 并发下移实验

独立 benchmark，不修改正式查询路径或现有 `.node` prebuild。默认运行模拟索引，也可以只读测试真实 DIDX。所有生成数据和二进制位于已忽略的 `output/`、`target/`、`benchmark.node`。

本次已运行的结果、结论及剩余风险见 [REPORT.md](REPORT.md)。两套 benchmark 应依次执行，避免相互竞争 CPU。

本次测量的汇总、结论和已知限制见 [REPORT.md](REPORT.md)。两套 benchmark 应依次执行，避免相互竞争 CPU。

## 比较现有的两个候选 API

`compare-candidates.cjs` 比较正式 `DidxQueryService.candidate()` 与逐词典调用 Rust `DidxIndex.candidates()` 后使用正式规则全局合并的结果。后者每本词典只跨一次 N-API，仍由 Node 保持 8 本词典的并发上限。两条路径使用相同 libuv 线程数，无额外 Rayon 线程池。

本次结果见 [CANDIDATES-REPORT.md](CANDIDATES-REPORT.md)。先用下方原实验生成索引及数据清单，再依次运行：

```powershell
node --test tests/native/didx-query-benchmark/candidates.test.cjs tests/native/didx-query-benchmark/collection.test.cjs
node tests/native/didx-query-benchmark/compare-candidates.cjs --dataset tests/native/didx-query-benchmark/output/real/results.json --output tests/native/didx-query-benchmark/output/candidates-real
node tests/native/didx-query-benchmark/compare-candidates.cjs --dataset tests/native/didx-query-benchmark/output/synthetic/results.json --output tests/native/didx-query-benchmark/output/candidates-synthetic
```

默认复用清单中的索引顺序、查询词和词典规模，执行 limit=50、libuv 4/8 线程、5 轮各 5 次，预热 2 次。可用 `--counts 1,8,20`、`--threads 4,8`、`--limits 1,5,50`、重复 `--query`、`--rounds`、`--repetitions` 和 `--warmup` 覆盖参数。程序会校验索引及 addon 哈希，报告同时给出全部查询与完整结果相同子集的性能，原始 JSON 保留两边完整候选和差异。两个算法的结果不一致会被记录；任一路径在不同轮次返回不稳定结果则报错。

先通过下方原有 `run.cjs` 命令生成数据集元信息，再运行：

```powershell
node --test tests/native/didx-query-benchmark/candidates.test.cjs
node tests/native/didx-query-benchmark/compare-candidates.cjs --dataset tests/native/didx-query-benchmark/output/real/results.json --output tests/native/didx-query-benchmark/output/candidates-real
node tests/native/didx-query-benchmark/compare-candidates.cjs --dataset tests/native/didx-query-benchmark/output/synthetic/results.json --output tests/native/didx-query-benchmark/output/candidates-synthetic
```

默认沿用原数据集的索引、词典规模和查询词，支持 `--counts 1,8,20`、`--threads 4,8`、`--limits 1,5,50`、`--rounds 5`、`--repetitions 5`、`--warmup 2` 以及重复的 `--query`。打开前校验索引和原生源码/addon 哈希，避免混用不同文件或构建。

每次请求都比较全部候选字段、界面实际字段及词序，不一致不会跳过；同时检查两条路径各自是否稳定。报告分别给出全部查询及完整结果相同子集的耗时；原始 JSON 保留两边完整输出、增删词、共同词字段变化和逐次延迟。该实验不修改 native 算法，不添加通配符改道，因而可以直接观察现有两个 API 的语义差异。

`diagnose-candidates.cjs RESULTS_JSON OUTPUT_JSON` 在计时结束后读取实际 exact/loose/prefix 结果，诊断哪些词典会进入原生 fuzzy 补足分支。它不参与计时，也不是 CPU profiler。

在仓库根目录运行：

```powershell
node tests/native/didx-query-benchmark/build.mjs
node --test tests/native/didx-query-benchmark/collection.test.cjs
node tests/native/didx-query-benchmark/run.cjs --output tests/native/didx-query-benchmark/output/synthetic
node tests/native/didx-query-benchmark/run.cjs --index-root "$env:APPDATA/dictol/dictionary-index" --output tests/native/didx-query-benchmark/output/real
```

构建默认 `--locked --offline --release`，需要本机已有 Cargo 依赖缓存；首次下载依赖可传 `build.mjs --online`。Windows 需要 MSVC 工具链，macOS 需要 Xcode command line tools（生产 addon 内含 AppKit bridge）。Node 与仓库要求相同，使用根目录安装的 TypeScript。

每次运行输出 `report.md`、`results.json` 和每个线程配置的原始结果 JSON。报告含均值、P50、P95、按轮统计和加速比，JSON 保留每次请求耗时、参数、索引元数据/大小/哈希、源码和 addon 哈希。

## 实验方法

当前 main 层 `DidxQueryService` 的词典并发上限为 8；每本词典内部用 `Promise.all` 同时发 exact、loose、prefix。每项查询都是 libuv AsyncTask，真正执行并发受 `UV_THREADPOOL_SIZE` 限制（默认 4）。普通阶段所有词典查询完后，JS 全局排序、合并、去重；无候选时才跨全部词典做 fuzzy。通配符走 wildcard。

不能直接用 Rust 单词典 `candidates()` 对照：它会做单词典去重、截断及补充 fuzzy，与当前 main 的全局策略不同。本实验执行相同的查询操作和精确截断规则。

- Node：内存编译并加载当前生产 `DidxQueryService`，直接运行 `candidate()`。
- Rust：`NativeDidxCollection` 长期持有全部索引，使用固定 Rayon 线程池；动态领取词典，保持至多 8 本词典处于查询中，每本内部 `rayon::join` exact/loose/prefix。每个 normal/wildcard/fuzzy 阶段用一个 AsyncTask，返回与 Node 相同顺序的完整原始结果。
- Rust 结果交给生产 JS 的同一套合并方法；fuzzy 回退条件和通配符判断也沿用生产逻辑。测量包含合并成本，从 Node 调用到最终候选结果。
- Node 的单词典绑定通过 Rust 模块直接引用生产源码，与实验集合编入同一 release addon。两边使用同一解析器/编译参数/依赖版本，避免旧 prebuild 造成偏差。
- 每个配置在独立 Node 子进程运行；启动前设定 `UV_THREADPOOL_SIZE`。默认 `4:4,8:8,4:8` 表示 `UV:Rust`，前两个为等工作线程数，最后一个同时评估线程扩容。
- 双方分别打开同一文件，预热独立实例；计时不含打开/构建；每次查询交替 Node/Rust 先后顺序，每轮轮换词序。每个预热及计时请求都做完整结果深比较，校验排序、dictionaryIds、locator 等全部字段，比较在计时区域外。
- 所有请求逐次执行，代表单次候选词查询延迟，不是大量并发请求的吞吐量测试。测试不清空 OS 页缓存，代表热缓存。

`set/remove/clear` 仅供实验集合生命周期验证：替换保留顺序；打开失败保留旧索引；进行中任务持有调用时的 Arc 快照，增删不影响旧查询。正式 manager 的懒加载、分组、文件删除等待与失效策略未迁移。

## 参数

| 参数                                    | 默认值 / 作用                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `--index-root DIR`                      | 递归读取真实 `.didx`，按路径排序；不会修改文件                                          |
| `--manifest FILE`                       | JSON 字符串数组，列出有序 DIDX 路径；相对路径基于 manifest 所在目录；与 index-root 互斥 |
| 无数据参数                              | 生成 24 份各有 10000 个生成词头及固定词汇的模拟索引；不是重复打开同一文件               |
| `--dictionaries N --entries N`          | 模拟词典数量和每本生成词头数                                                            |
| `--counts 1,8,20`                       | 测试前 N 份索引；默认 1、min(8,总数)、总数                                              |
| `--profiles 4:4,8:8,4:8`                | libuv 线程数:Rust 工作线程数                                                            |
| `--rounds 5 --repetitions 5 --warmup 2` | 每配置每词，5 轮各 5 次，另预热 2 次                                                    |
| `--limit 50`                            | 与正式服务相同的候选上限，支持 0–10000                                                  |
| `--query apple --query applf`           | 覆盖默认查询集；可多次指定                                                              |
| `--output DIR`                          | 输出位置，默认 output 下的 UTC 时间戳目录                                               |

默认词集覆盖完整单词、短前缀、大结果集、通配符、拼写错误、无命中及中文。模拟数据还含大小写、重复词头、重音、全角和非 BMP 字符；正确性测试覆盖这些语义。真实数据按文件路径取子集，不代表应用内词典顺序或启用状态；可用 manifest 明确指定。

结果中低于 1× 代表 Rust 更慢。汇总为查询词等权的平均延迟，收益依赖词典、词长、返回数和 fuzzy 比例。首次加载、进程内多请求竞争、取消、后台任务竞争、Electron IPC、UI 与内存不在测量范围。需要独立重复运行并结合真实输入分布判断是否值得接入。
