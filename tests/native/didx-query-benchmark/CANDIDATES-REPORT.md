# 正式 Node candidate() 与现有 Rust candidates() 对照

两条路径目前不等价，现有 Rust `DidxIndex.candidates()` 不适合作为正式 Node `DidxQueryService.candidate()` 的直接替换。真实 20 本词典、默认 limit=50 的 13 个查询中，仅 8 个完整结果相同；改用 Rust API 后，全部查询平均耗时约为正式路径的 4.3–4.5 倍。仅统计结果完全相同的 8 个查询，Rust API 耗时仍约为 Node 的 3.1–3.3 倍。

这次比较的是现有两个 API，不是[此前保持语义一致的 Rust 集合并发实验](REPORT.md)。本次没有修改 Rust 算法或正式查询路径。

## 对照方案与样本

测试时间为 2026-11-24（北京时间）。机器为 Intel Core Ultra 7 165H，22 逻辑处理器，Windows x64，Node 26.4.0。沿用此前 release addon，读取当前生产单词典绑定及解析器源码；双方使用同一二进制、同一批 DIDX 文件和相同 libuv 线程数。

- 正式路径：直接执行 `DidxQueryService.candidate()`，每词典分别调用 exact/loose/prefix；全局合并为空时再调用 fuzzy；支持的通配符走 wildcard。
- Rust API 路径：Node 按正式 `queryEach` 的方式、最多并发处理 8 本词典，每本调用一次 `DidxIndex.candidates(query, limit)`，再复用正式 `mergeCandidates` 全局排序、去重、截断并聚合 dictionaryIds。不另加全局 fuzzy 回退，也不为通配符改道，以保留现有 Rust API 的实际行为。
- 两边分别持有独立打开的相同索引。计时从 Node 发起调用直到得到最终候选结果，包含 JS 全局合并；排除打开、预热、结果比较及 Electron IPC/UI。每次交替先后执行，每轮轮换词序，热 OS 页缓存。
- 真实索引 20 本、92.13 MiB，测量规模为 1/8/20；模拟索引 24 本，每本 10,000 个生成词头另加固定词汇，测量规模为 1/8/24。真实索引名单沿用本地文件快照，不代表数据库当前启用的词典名单。
- 每配置每词 5 轮 × 5 次，另预热 2 次；limit=50；分别用 4 和 8 个 libuv 线程。查询词沿用此前的 13 个：`apple`、`hello`、`abandon`、`app`、`trans`、`a`、`word`、`app*`、`a??`、`applf`、`helo`、`zzqvxtest`、`中文`。

每次在计时区外做比较：完整结果含顺序、locator、keyOrdinal、matchKind、distance、词典归属等全部字段；界面结果则比较正式 `searchDictionaryEntries()` 返回的 word、normalizedWord、dictionaryIds 及顺序。同时检查每条路径自身在各次执行中保持确定性。两条路径之间的差异会记录，不会被忽略或修正。

## 性能与一致性

真实 20 本词典：

| libuv 线程 | 完整相同 | 界面相同 | 全部查询 Node / Rust API 均值 ms | Rust / Node 耗时倍数 | 完整相同子集 Node / Rust API 均值 ms | Rust / Node 耗时倍数 |
| ---------: | -------: | -------: | -------------------------------: | -------------------: | -----------------------------------: | -------------------: |
|          4 |     8/13 |     8/13 |                 30.463 / 129.934 |                4.27× |                     41.410 / 130.183 |                3.14× |
|          8 |     8/13 |     8/13 |                 27.939 / 124.688 |                4.46× |                     37.598 / 125.623 |                3.34× |

“全部查询”的耗时包含结果不等价的请求，用于比较当前实际工作量，不代表等价优化的收益。混合均值按查询词等权，也不能当作普通打字时每次候选请求的固定耗时。

模拟 24 本小词典：

| libuv 线程 | 完整相同 | 全部查询 Node / Rust API 均值 ms | 完整相同子集 Node / Rust API 均值 ms | 相同子集延迟降低 |
| ---------: | -------: | -------------------------------: | -----------------------------------: | ---------------: |
|          4 |    11/13 |                    1.110 / 0.974 |                        1.226 / 1.022 |            16.6% |
|          8 |    11/13 |                    1.152 / 0.999 |                        1.267 / 1.025 |            19.1% |

模拟数据的不一致来自两个通配符查询；其余 11 个查询在这些样本中完整相同。小词典上减少跨边界调用能带来一定收益，但该结果不能推广到实际大词典。完整的各规模、逐词均值、P50/P95 和差异明细见[真实数据报告](report-candidates-real.md)与[模拟数据报告](report-candidates-synthetic.md)。

## 结果差异

真实 20 本词典在 4/8 线程下的语义比较结果一致：

| 查询      | Node / Rust API 候选数 | 差异                                                               |
| --------- | ---------------------: | ------------------------------------------------------------------ |
| `hello`   |                33 / 36 | Rust 多出 `helle`、`helluo`、`heluo`                               |
| `abandon` |                47 / 49 | Rust 多出 `awandan`、`andon`                                       |
| `中文`    |                 2 / 50 | Rust 补入大量 fuzzy 候选，例如 `中专`、`中东`、`中丞`              |
| `app*`    |                50 / 50 | 词列表不同，Rust 缺少部分 Node 通配符命中，返回了额外普通/模糊候选 |
| `a??`     |                50 / 50 | 词列表不同，Rust 返回了不符合 Node 通配符语义的词                  |

其余 `apple`、`app`、`trans`、`a`、`word`、`applf`、`helo`、`zzqvxtest` 的完整结果相同。这只是固定样本的一致性，不意味着这些类型的所有输入都等价。

源码（[Node candidate](../../../src/main/didx-query-service.ts)、[Rust candidates](../../../native/mdict/src/index.rs)）与独立构造用例还确认了以下普遍差异：

1. fuzzy 触发时机：Node 仅在所有词典全局无候选时执行；Rust 每本词典正常结果去重后不足 limit 就执行。即使最终全局列表相同，Rust 仍可能多做大量查询。
2. fuzzy 距离层级：Node 全局 fallback 只保留最小距离层；Rust 组合 API 可能保留各词典独立选出的不同距离层。独立测试用 `applf` 验证了 Node 只保留距离 1，而 Rust 路径另保留距离 2 的 `applet`；本批真实数据的 `applf` 恰好完整相同。
3. 通配符：Rust `candidates()` 没有 Node 的 wildcard 分派，不能直接接管含 `*`/`?` 的候选查询。
4. 截断与去重位置：Rust 先按显示词头在每本词典内去重、截断，再全局合并；Node 先取得各阶段结果再全局合并，其 exact 阶段还会先按物理命中截断。因此不能只依据局部候选数量推断所有输入等价。

## 为什么减少调用反而变慢

20 本词典的普通查询，从 Node 分别调用三个接口，改为每词典一次 `candidates()`，N-API 方法调用数从 60 降至 20。但现有 Rust 组合 API 同时改变了内部工作量。

用实际 exact/loose/prefix 结果检查源码的 fuzzy 分支条件，得到：

| 查询    | Node 全局正常候选数 | Node 进入 fuzzy | Rust 满足 fuzzy 条件的词典数 |
| ------- | ------------------: | --------------- | ---------------------------: |
| `apple` |                  50 | 否              |                        19/20 |
| `hello` |                  33 | 否              |                        20/20 |
| `app`   |                  50 | 否              |                         8/20 |
| `中文`  |                   2 | 否              |                        20/20 |

例如 4 线程下，`apple` 最终结果完全相同，但 Node 为 1.521 ms，Rust API 为 145.203 ms；`applf` 两边原本都要做 fuzzy，则为 150.131 ms 与 150.932 ms。原本很轻的正常查询被额外 fuzzy 检索拖慢，减少调用次数无法抵消这部分工作。

Rust 的 fuzzy 只返回本词典最佳距离层；有 exact 命中时可能返回距离 0 的原词，再被 `seen` 去重。因此“进入 fuzzy”既可能改变候选，也可能消耗计算后完全不改变最终结果。

上述分支诊断保存在 [fuzzy-diagnostics.json](output/candidates-real/fuzzy-diagnostics.json)，可用 `diagnose-candidates.cjs` 重现。它依据真实查询结果及源码分支条件判断，没有用分阶段 CPU profiling 量化每项成本。

结论是先统一候选语义，再评估将三个查询组合成一个 Rust 调用的收益。当前直接替换既会改变结果，也会明显拖慢本批真实词典的常规查询。

## 改动与验证

此次新增 `candidates-harness.cjs`、`candidates-worker.cjs`、`compare-candidates.cjs`、`candidates.test.cjs`、`diagnose-candidates.cjs` 和本报告及两份明细报告；`harness.cjs` 仅增加导出既有服务和 limit helper，`README.md` 增加复现说明。全部位于 `tests/native/didx-query-benchmark/`，没有修改生产代码、Rust 算法或现有 prebuild。

验证命令：

```powershell
node --test tests/native/didx-query-benchmark/candidates.test.cjs tests/native/didx-query-benchmark/collection.test.cjs
node tests/native/didx-query-benchmark/compare-candidates.cjs --dataset tests/native/didx-query-benchmark/output/real/results.json --output tests/native/didx-query-benchmark/output/candidates-real --rounds 5 --repetitions 5 --warmup 2
node tests/native/didx-query-benchmark/compare-candidates.cjs --dataset tests/native/didx-query-benchmark/output/synthetic/results.json --output tests/native/didx-query-benchmark/output/candidates-synthetic --rounds 5 --repetitions 5 --warmup 2
node tests/native/didx-query-benchmark/diagnose-candidates.cjs tests/native/didx-query-benchmark/output/candidates-real/results.json tests/native/didx-query-benchmark/output/candidates-real/fuzzy-diagnostics.json
```

4 项测试通过；新增及相关脚本的 ESLint 检查通过，Prettier 格式检查通过；两套完整矩阵和诊断均正常退出。两套矩阵共 7,800 次计时查询、624 次预热查询，每次均完成跨路径比较，两条路径各自的结果在多次运行中保持不变。本报告没有把已观察到的跨路径差异说成测试通过率。

原始完整结果、逐次延迟、每轮统计和哈希分别保存在本地忽略目录 [candidates-real/results.json](output/candidates-real/results.json) 和 [candidates-synthetic/results.json](output/candidates-synthetic/results.json)。未验证 Electron/UI 端到端、冷缓存、内存、非 Windows 平台和多个查询同时进行；各配置仅各一套进程、进程内多轮采样，没有报告统计显著性或置信区间。
