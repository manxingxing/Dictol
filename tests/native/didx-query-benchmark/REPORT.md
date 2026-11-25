# DIDX 并发下移评估

本次实验中，仅将跨词典并发调度移至 Rust，收益有限且依赖负载：真实 20 本词典在等工作线程数下未见整体提速；模拟 24 本小词典约有 2%–5% 的延迟改善。现有数据不足以支持“迁移后会显著提速”的预期。

测试于 2026-11-24（北京时间）完成。机器为 Intel Core Ultra 7 165H，22 逻辑处理器，Windows x64，Node 26.4.0，Rust 1.97.0，release/LTO 构建。

## 主要结果

主实验每配置、每词执行 7 轮 × 10 次，另预热 3 次。测试 13 个查询词，覆盖普通候选、短前缀、通配符、拼写纠错、无结果及中文。混合均值按查询词等权；加速比为 Node/Rust，大于 1 表示 Rust 更快。

| 数据      | 词典数 | Node libuv 线程 | Rust 工作线程 | Node 均值 ms | Rust 均值 ms | 加速比 | 延迟降低 |
| --------- | -----: | --------------: | ------------: | -----------: | -----------: | -----: | -------: |
| 真实 DIDX |     20 |               4 |             4 |       32.924 |       33.560 |  0.98× |    -1.9% |
| 真实 DIDX |     20 |               8 |             8 |       29.200 |       30.822 |  0.95× |    -5.6% |
| 真实 DIDX |     20 |               4 |             8 |       34.354 |       30.659 |  1.12× |    10.8% |
| 模拟 DIDX |     24 |               4 |             4 |        1.455 |        1.423 |  1.02× |     2.2% |
| 模拟 DIDX |     24 |               8 |             8 |        1.359 |        1.286 |  1.06× |     5.4% |
| 模拟 DIDX |     24 |               4 |             8 |        1.161 |        1.115 |  1.04× |     4.0% |

“Node 4 / Rust 8”同时改变了执行线程数，不能把收益全部归因于并发下移。不同配置由不同进程运行，基线会波动；应比较同一行中交替执行的 Node/Rust，不宜直接将不同行当成线程扩容的精确收益。

更多词典规模及逐词 P50/P95、每轮范围见[真实索引报告](report-real.md)和[模拟索引报告](report-synthetic.md)。真实数据来自本机现有 20 份 DIDX，合计 96,604,787 字节（92.13 MiB），不是从数据库读取的“当前启用词典”名单；模拟数据为 24 份独立生成索引，每份 10,000 个生成词头另加固定测试词汇。规模分别测试 1/8/20 与 1/8/24。

## 独立进程复测

另起一套进程，仅测试真实 20 本词典，每配置每词 3 轮 × 10 次，另预热 3 次。完整复测通过，方向与主实验一致：

| Node libuv 线程 | Rust 工作线程 | Node 均值 ms | Rust 均值 ms | 加速比 | 延迟降低 |
| --------------: | ------------: | -----------: | -----------: | -----: | -------: |
|               4 |             4 |       32.720 |       33.541 |  0.98× |    -2.5% |
|               8 |             8 |       28.429 |       29.927 |  0.95× |    -5.3% |
|               4 |             8 |       39.840 |       36.952 |  1.08× |     7.2% |

详见[完整复测报告](report-real-repeat.md)及 [output/real-repeat-complete/results.json](output/real-repeat-complete/results.json)。主实验与完整复测均显示：等线程没有整体提速；扩大 Rust 线程池时约降低 7%–11% 的混合延迟，但无法把这部分归因为调度语言的变化。

在此之前的一次额外复测失败：第二个配置完成计时、写出原始 JSON 后，子进程退出时触发 `UV_HANDLE_CLOSING` 断言，退出码为 `3221226505`，第三个配置尚未执行。runner 正确将非零退出判为失败，没有生成完整报告，也没有将该次数据计入上述汇总。失败记录保存在 [output/real-repeat/failure.txt](output/real-repeat/failure.txt)。

该退出异常的根因尚未定位。Node 上游有[同类 Windows 退出断言记录](https://github.com/nodejs/node/issues/56645)，但仅凭断言文本不能确定本次具有相同根因。没有添加延时、强制退出或忽略退出码的绕过；后一次完整复测成功也不代表该稳定性问题已解决。

## 如何解读

真实 20 本词典、双方 4 线程时，部分轻查询确有收益，例如 `中文` 从 0.313 ms 降至 0.168 ms。但 `applf` 约 167 ms、无结果 `zzqvxtest` 约 173–178 ms，移动并发后没有明显改善；大量前缀返回的 `app` 从 3.438 ms 增至 4.310 ms。混合均值因而容易被慢查询主导，不能把混合均值当作普通打字时每次候选请求的固定耗时。

代码可确认，当前 DIDX 检索本来就在 Rust 执行，Node 负责分发异步任务及聚合结果。本实验减少了 N-API 调用次数，仍保留相同的索引检索、结果转换、JS 排序和去重成本，同时增加了 Rayon 调度和一次批量结果返回。这是收益受限的合理解释，尚未通过分阶段 CPU profiling 定量归因。

本次结果支持先保留正式查询路径。若后续继续评估 Rust 聚合，应将全局排序、去重、Top-K 等作为另一项实验，单独验证语义和收益；本报告没有测量这些改动。

## 实现与验证

- `src/collection.rs`：实验用 Rust 索引集合；支持增删替换、查询时 Arc 快照、8 本词典并发上限及持久 Rayon 线程池。普通阶段仍并发 exact/loose/prefix；不能替换成语义不同的单词典 `candidates()`。
- `src/lib.rs`、`Cargo.toml`、`Cargo.lock`、`build.rs`、`build.mjs`：独立 addon，直接编入生产单词典绑定和解析器；不覆盖现有 prebuild。
- `harness.cjs`：加载真实 `DidxQueryService`，复用其排序、去重、通配符识别及 fuzzy 回退；`worker.cjs` 负责预热、交替计时和完整结果比较；`run.cjs` 负责数据、独立进程、线程配置及报告输出。
- `collection.test.cjs`：验证 Unicode、重复词头、通配符、fuzzy、limit、顺序、locator、词典归属、增删替换、打开失败和进行中任务快照；另验证统计公式。`README.md` 提供复现命令和参数。

已执行：

```powershell
node tests/native/didx-query-benchmark/build.mjs
node --test tests/native/didx-query-benchmark/collection.test.cjs
node node_modules/eslint/bin/eslint.js tests/native/didx-query-benchmark/*.cjs tests/native/didx-query-benchmark/*.mjs
```

Release 构建成功；2 项测试通过；ESLint 无错误和警告。构建中出现的 3 条 Rust warning 来自生产 macOS selection panel 模块在 Windows 下的未使用项，未改动该模块。

两套主实验共 32,760 次计时查询，每次都在计时外比较完整结果，全部一致；另有 1,404 次预热查询。原始逐次延迟、各轮统计、完整参数、索引及源码 SHA-256 保存在本地忽略目录 [output/real/results.json](output/real/results.json) 和 [output/synthetic/results.json](output/synthetic/results.json)。

完整独立复测另有 2,340 次计时查询和 234 次预热查询，结果也全部一致。以上次数不包含失败复测的数据。

未验证项：Electron IPC/UI 端到端耗时、冷缓存、多个用户查询并发、取消、后台 libuv 竞争、内存和非 Windows 平台。实验由 Node 独立进程执行，不是 Electron 内直接运行；双方使用本实验 Cargo.lock 的依赖版本（NAPI 3.12.0），没有使用已安装的生产 prebuild。正式 manager 的懒加载、分组、文件删除等待和生命周期没有接入；全部改动限于本实验目录，没有修改生产查询路径或用户词典。
