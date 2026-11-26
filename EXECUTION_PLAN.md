# Dictol 执行计划与上下文摘要

> 更新日期：2026-07-24
> 当前阶段：原生解析、索引、查询与资源链路已实现，进入真实词典体验验证。

## 0. 当前实现状态

- Electron、React、Tailwind CSS、shadcn/ui、React Router、TanStack Query、Zustand 已接入。
- 正式解析层已切换为项目内的 Rust `native/mdict`，通过 Node-API 供 Electron 主进程直接调用。
- 上传 MDX 后由按需创建的导入 Worker 复制同目录的 MDD/CSS/JS/PNG 文件，并以 2,000 条为一批流式遍历 MDX，将词条、规范化词条和 record offset 写入 SQLite；每批使用一个独立小事务。
- 搜索使用 SQLite 前缀范围查询；词条正文不入库，打开结果时由 Rust 按 offset 从 MDX 读取。
- `dictol-resource://` 协议负责外置文件及多 MDD 资源读取；同一资源会并行查询多个 MDD，图片和音频按需缓存到 `app.userData/resource-cache`。
- 搜索界面已支持实时建议、空输入时显示最近 50 个查询词、回车打开第一项；数据库按规范化词头分组返回多个词典入口，内容区使用 shadcn Tabs 在各词典结果间切换。词条 HTML 在独立 `WebContentsView` 中运行，支持右键/选中文本查词和内部链接查询。
- 成功打开词条后按规范化词头写入 SQLite 查询历史，不绑定具体词典记录；再次查询会递增次数并更新 `last_queried_at`，最多保留最近 200 条，并支持从历史重新查询或清空记录。
- 最小 MDX/MDD 端到端测试、OALDPE/LDOCE5 真实文件回归、Rust 单测、Node-API 测试、Clippy、TypeScript、ESLint 和生产构建均已纳入验证。

## 1. 产品目标

构建一个桌面端词典应用，允许用户导入 MDX/MDD 词库并搜索词条，尽可能忠实呈现词典自带的 HTML、CSS、图片、音频及 JavaScript 交互。

首批真实验证词典：

- OALDPE：Oxford Advanced Learner's Dictionary 英汉双解精装版。
- LDOCE5：Longman Dictionary of Contemporary English 5++ En-Cn V2.15。

应用只提供用户自行导入能力，不随安装包分发上述词典。OALDPE 元数据明确标注仅限个人学习研究、禁止商业用途；LDOCE5 也包含第三方版权内容，后续发布前需单独核查授权边界。

## 2. 已确定的技术方向

### 2.1 技术栈

- 桌面框架：Electron。
- 应用前端：React。
- 主进程/后端协调层：Node.js。
- MDX/MDD 解析：项目内 Rust `native/mdict`。
- Node 集成：NAPI-RS 生成的 `@dictol/mdict-native` 原生模块。
- 本地索引数据库：SQLite（WAL 模式），数据库文件为 Electron `app.userData/dictol.sqlite`。

### 2.2 进程边界

- Renderer 不直接调用 js-mdict 或访问词典文件。
- Renderer 只调用受控的 preload API。
- Node.js 后端负责查询 SQLite、调用原生解析模块、组合词条响应及管理导入任务。
- Rust 原生模块负责 MDX/MDD 元数据解析、分批遍历和按定位读取记录/资源。
- NAPI 的扫描与读取接口以异步任务暴露，避免在 Renderer 中执行解析。
- Electron 主进程持有 SQLite 一般查询连接；导入 Worker 只在导入期间创建，并持有独立写连接。

### 2.3 存储原则

导入词典时：

- 保存词典元数据、源文件信息、词条键和记录定位信息。
- 保存 MDD 资源键和对应分卷/定位信息。
- 不把词条 HTML、图片、音频、字体等大块内容复制到 SQLite。

查询词条时：

- 先从 SQLite 找到一个或多个记录定位信息。
- Node 调用 Rust 原生模块从原始 MDX/MDD 读取内容。
- 在查询阶段解析重定向并组合页面。

源文件移动、修改或替换后，原定位信息可能失效。词典表必须保存至少：文件大小、修改时间和内容指纹；打开词典时校验，失效后要求重新索引。

## 3. 推荐总体架构

```text
React Renderer
  │
  │ typed preload API
  ▼
Electron Main / Node Backend
  ├── SQLite 读连接：词典、词条和资源索引查询
  ├── 导入任务与进度管理
  ├── 查询、别名解析、页面组合
  ├── 自定义协议处理
  └── 按需导入 Worker
        ├── SQLite 独立写连接（每批 2,000 条事务）
        └── Rust native/mdict / NAPI-RS
        ├── MDX/MDD 头部与版本解析
        ├── Encrypted=2 索引解密
        ├── key list 与 record block 解析
        ├── key block lookup / stable locator
        ├── MDD 资源读取
        └── 批量导入与随机读取
```

## 4. 词典页面隔离

词典 HTML/JS 不直接注入 React DOM，也不使用 iframe。当前使用独立的 `WebContentsView` 运行词典页面，React 内容区通过 `ResizeObserver` 与主进程同步原生 View 的 bounds：

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- 不向词典页面暴露 Electron、Node.js、文件系统或通用 IPC；专用 preload 只允许上报查词目标。
- 使用 `dictol-entry://dictionary-<id>/...` 为每部词典提供独立 origin，隔离 Cookie 和 localStorage。
- React 路由负责选择词条、View 显隐和 bounds；词典页的导航、音频及查词由主进程桥接。

建议注册自定义协议：

```text
dictol-entry://dictionary-<id>/<entry-id>
dictol-resource://dictionary-<id>/oaldpe.css
dictol-resource://dictionary-<id>/LM5style.css
dictol-resource://dictionary-<id>/media/english/ameProns/apple1.mp3
```

协议处理器只接受已注册词典和规范化后的相对资源键，必须阻止路径穿越。响应应设置准确 MIME 类型、缓存策略和词典级 CSP。

特殊协议处理：

- `entry://...`：阻止默认导航，转换为当前词典的词条查询；保留 fragment/anchor。
- `sound://...`：阻止默认导航，通过资源索引读取 MDD 音频并播放。
- 相对 URL：先查词典旁的外置文件，再查 MDD 资源索引。
- `http`、`https`、`wss`：按词典级网络权限允许或阻止。

## 5. 建议数据模型

具体 SQL 在实现阶段确定，逻辑模型至少包含以下实体。

### 5.1 Dictionary

- `id`
- `title`
- `format_version`
- `encoding`
- `encrypted_mode`
- `key_case_sensitive`
- `strip_key`
- `source_directory`
- `mdx_file`
- 外置文件清单
- 导入状态、错误和进度
- 文件大小、mtime、快速指纹/完整哈希
- 词典适配器类型，例如 `generic`、`oaldpe`、`ldoce5`

### 5.2 DictionaryFile

- `dictionary_id`
- 文件角色：`mdx`、`mdd`、`mdd-volume`、`external-resource`
- 分卷序号
- 路径
- 大小、mtime、指纹
- 文件自身的 MDict 头部配置

注意：同一词典的不同 MDX/MDD 文件可能具有不同 `Encrypted` 值，必须逐文件解析，不能继承主 MDX 设置。

### 5.3 EntryIndex

- `dictionary_id`
- `term_original`
- `term_normalized`
- `record_locator`
- `ordinal`
- 可选 `record_kind_hint`

`term` 不能唯一。主键应以词典、记录位置和序号为基础。查询必须返回同一个键的全部记录。

### 5.4 ResourceIndex

- `dictionary_id`
- `resource_key_original`
- `resource_key_normalized`
- `dictionary_file_id`/MDD 分卷
- `record_locator`
- 可选 MIME/扩展名提示

MDD 资源键通常以反斜杠开头；URL 路径进入索引前需要将 `/` 转换为 `\` 并补齐前导 `\`。

### 5.5 Locator 要求

Locator 的最终字段由 js-mdict `KeyWordItem` 和底层 record offset 能力决定，目标是重启后无需重新按词搜索即可读取记录。可能包含：

- 解压后的全局 record offset 和 length。
- record block 编号。
- block 的压缩文件偏移、压缩长度和解压长度。
- 记录在解压 block 内的 offset 和 length。

阶段 1 必须验证这些字段是否属于稳定、可序列化、可跨进程重启复用的接口。若 js-mdict 暂时不能按持久化 locator 读取，第一版允许降级为：

```text
SQLite 保存 dictionary_id + term + ordinal
→ Worker 调用 lookupAll(term)
→ 按 ordinal 选择记录
```

此时 SQLite 负责跨词典检索、排序和过滤，js-mdict 自身的内存 key list 负责文件内定位。长期目标仍是给适配层补充稳定的批量 key/locator 和按位置读取接口。

## 6. 通用 MDX 查询语义

查询结果不是单一记录，必须支持：

1. 使用词典头部规则规范化查询键。
2. 从 SQLite 读取该键的全部记录位置。
3. 逐条按位置读取原始记录。
4. 正文记录保留。
5. `@@@LINK=<target>` 记录递归解析目标键。
6. 使用 `visited` 集合阻止循环。
7. 设置最大递归深度，初始建议为 8。
8. 合并直接记录和解析出的目标内容。
9. 由词典适配器完成必要的兼容处理。

通用层不得假设记录一定是完整 HTML，也不得用固定文本分隔符拼接后直接交给浏览器。

## 7. OALDPE 实测摘要

目录当前包含：

- `oaldpe.mdx`
- `oaldpe.mdd`
- `oaldpe.1.mdd`
- `oaldpe.2.mdd`
- `oaldpe.3.mdd`
- `oaldpe.css`
- `oaldpe.js`
- `oaldpe-jquery.js`
- `oaldpe.png`

### 7.1 格式与规模

| 文件           | MDict 版本 | Encrypted |  记录数 | 主要内容            |
| -------------- | ---------: | --------: | ------: | ------------------- |
| `oaldpe.mdx`   |        2.0 |         2 | 622,808 | 词条 HTML           |
| `oaldpe.mdd`   |        2.0 |        No |      72 | CSS、字体、配置资源 |
| `oaldpe.1.mdd` |        2.0 |         2 | 160,805 | MP3                 |
| `oaldpe.2.mdd` |        2.0 |        No |   1,874 | PNG                 |
| `oaldpe.3.mdd` |        2.0 |        No | 112,897 | MP3                 |

四个 MDD 格式相同，但文件自身的加密配置不同。`Encrypted=2` 是关键词索引加密，不要求用户输入密码。

### 7.2 词条结构

- 每条正式词条基本是完整 HTML 文档。
- 引用外置 `oaldpe.css`、`oaldpe-jquery.js`、`oaldpe.js`。
- 使用自定义标签，例如 `deft`、`chn`、`unboxx`。
- 使用 `entry://`、`sound://`、相对图片路径。
- CSS 引用的字体均存在基础 MDD。
- JS 为 jQuery 3.7.1 + OALDPE 自定义交互。
- JS 只依赖浏览器 API，不依赖 Node/Electron API。
- `localStorage` 用于持久化词典配置，因此应使用每词典独立 origin。

### 7.3 键重复

- 622,808 条记录。
- 615,914 个精确唯一键。
- 6,181 个键对应多条记录。
- 单键最多 6 条记录。

### 7.4 网络行为

默认配置并非完全离线：

- 单词发音默认离线。
- 图片默认离线。
- 官方例句发音默认在线。
- Edge TTS 默认开启，使用 Bing Speech WebSocket。
- 本地脚本失败时会回退到 CDN。

必须由宿主控制网络权限。建议默认阻止任意联网，用户明确开启在线发音/TTS 后，只开放必要域名和协议。

### 7.5 OALDPE 专属适配

- 优先从词典目录读取三个外置 CSS/JS，再查询 MDD。
- 保留完整 HTML 文档结构。
- 拦截 `entry://` 和 `sound://`。
- 允许 CSS 字体、图片及本地动态脚本通过同一词典 origin 加载。
- 不模拟 Eudic/GoldenDict UA，避免执行宿主专属分支。

## 8. LDOCE5 实测摘要

目录当前包含：

- `LDOCE5.mdx`
- `LDOCE5.mdd`

### 8.1 格式与规模

| 文件         |     大小 | MDict 版本 | Encrypted |  记录数 |
| ------------ | -------: | ---------: | --------: | ------: |
| `LDOCE5.mdx` | 约 184MB |        2.0 |         2 | 283,110 |
| `LDOCE5.mdd` | 约 1.2GB |        2.0 |         2 | 183,926 |

MDX 配置：

- `Encoding=UTF-8`
- `KeyCaseSensitive=No`
- `StripKey=Yes`
- `Format=Html`
- `Compact=Yes`
- `StyleSheet` 为空

### 8.2 页面资源

词条是 HTML 片段，每个正式词条引用：

- `LM5style.css`：存在于 MDD。
- `LM5style_switch.css`：缺失。
- `LM5style_show.css`：存在于 MDD，用 CSS 边框作为 MDD 存在标志。
- `jquery-3.2.1.min.js`：存在于 MDD。
- `LM5Switch.js`：存在于 MDD。
- `LM5pp_config.ini`：缺失。

缺失的 `.ini` 不致命，`LM5Switch.js` 内置完整默认值；缺失的 switch CSS 可能影响少量状态样式，但主样式和主要交互可用。协议层应正常返回 404，不要因此中止整个词条加载。

### 8.3 重定向与多记录

- 283,110 条记录中有 218,252 条 `@@@LINK`。
- 约 64,858 条为实际内容。
- 35,081 个精确键具有重复记录。
- 单键最多 8 条记录。
- 正常别名链最大深度为 4。
- 存在 9 个循环组件，34 个键最终受循环影响。

循环示例：

```text
cockfight → cockfighting → cockfight
ghostwrite → ghostwriter → ghostwrite
sharecropper → sharecrop → sharecropper
lipread → lipread
```

LDOCE5 有 344 条不规范 link target，其中包含 HTML 标签、弯引号或 `↔`。实测通过以下专属规范化规则可全部恢复：

1. HTML entity decode。
2. 移除 HTML 标签。
3. `’` 转换为 `'`。
4. 规范化 `↔` 周围的空格。
5. 忽略大小写匹配。

这些规则只放进 LDOCE5 适配器，不污染通用 MDict 层。

### 8.4 图片

- 2,051 条 MDX 记录包含 `data:image/...`。
- 一部分正文通过 `@@@LINK` 引用隐藏的 MDX Base64 图片记录。
- MDD 仅含 15 个普通 JPG。

因此 LDOCE5 图片处理必须覆盖：正文内 Base64、MDX link target 中的隐藏图片节点、普通 MDD 图片资源。

### 8.5 音频

MDD 包含：

- 182,065 个 MP3。
- 1,842 个 Ogg Speex `.spx`，抽样为 22050Hz 单声道。

MP3 可直接通过 `sound://media/...` 映射到 MDD 键。SPX 不应假设 Chromium 能稳定播放；应把它作为独立媒体兼容项，比较 Speex WASM、本机 FFmpeg 子进程和第一版暂不支持三种方案。若实施转码，可在首次播放时按需转换为 WAV/PCM 或其他 Chromium 稳定支持的格式，并按资源哈希缓存结果。

### 8.6 UA 与在线行为

`LM5Switch.js` 看到桌面 Chrome UA 时，会把离线 MP3 改为 `http://www.ldoceonline.com/media/...`。Electron 默认 UA 会触发该行为。

为 LDOCE5 词典页面设置不含 `Chrome`、`Eudic`、`GoldenDict` 的专用 UA，同时保留平台标识，例如：

```text
Mozilla/5.0 (Macintosh) Dictol/1.0
```

这样可以保持桌面布局并使用本地 MDD 音频。最终 UA 需要在 macOS、Windows、Linux 上分别验证。

## 9. Rust 解析器实现

正式解析器为项目内的 `native/mdict`，Node 绑定位于 `native/mdict`。`js-mdict` 和 Python 工具仅作为行为对照与探索工具，不进入应用运行链路。

当前能力：

- 打开 MDX/MDD 时只解析头部和 block 元数据，不持有完整 key text 或 record 内容。
- `createScanner().nextBatch(size)` 分批遍历所有 key，并返回 key text、key block 与 record 起止 offset。
- `readRecord(start, end)` 根据全局解压偏移定位相应 record block，只解压命中的 block。
- `lookupKeyBlockByWord(word)` 和 `lookup(word)` 支持按键随机查找。
- MDD 返回原始 `Buffer`，不经过 Base64。
- 支持当前 OALDPE 与 LDOCE5 的 MDict 2.0、UTF-8/UTF-16、Encrypted=2、无压缩/zlib/LZO block。
- XML/HTML entity 采用 `quick-xml` 相关能力与兼容策略解析；未知实体保留原文。

Node 层运行约束：

- Renderer 只能通过受控 preload API 调用搜索和词条读取。
- Electron 主进程和导入 Worker 分别持有 SQLite 连接；Rust 不直接访问数据库。
- 原生词典实例按文件路径复用；后续需要补充显式关闭和 LRU 上限，避免用户同时启用大量词典时句柄持续增长。
- 多 MDD 查询由 Node 层并发调度，每个 MDD 的块定位与解压在原生异步任务中完成。

已验证：

- OALDPE MDX 与四个 MDD、LDOCE5 MDX/MDD 均可打开和流式遍历。
- 随机 record 内容与 `js-mdict` 对照一致。
- Node-API 可直接返回 BigInt offset 与 Buffer。
- 最小端到端样本覆盖导入、SQLite 前缀查询、按 offset 读取、MDD 资源解析和缓存命中。

## 10. 分阶段执行计划

> 以下阶段保留为路线图记录。阶段 0–3 的解析选型与索引验证已经由 Rust/NAPI 实现完成；阶段 5 和阶段 8 的本轮基础链路已经完成，重定向、多记录组合、媒体 Range/SPX、安全加固和跨平台打包仍按后续阶段推进。

### 阶段 0：冻结验证范围

目标：明确第一版必须支持的文件和功能，不写 UI。

- 将 OALDPE 与 LDOCE5 作为固定回归样本。
- 记录样本文件大小、哈希和元数据。
- 选定每部词典的代表性测试词条、别名、图片、MP3、SPX、专题页和循环别名。
- 明确第一版是否允许联网；建议基础版本默认离线，在线资源按词典授权。

验收：形成不可变的兼容性测试清单。

### 阶段 1：js-mdict 可行性原型

目标：不做 Electron UI，用 Node 诊断工具验证 js-mdict 的底层能力和资源成本。

- 锁定准确的 js-mdict 7.x 版本，打开全部 7 个 MDX/MDD 文件。
- 验证每个文件的版本、记录数、`Encrypted` 和编码与 Python 基线一致。
- 验证 OALDPE 与 LDOCE5 的重复键，确认 `lookupAll` 的结果、顺序和稳定性。
- 批量遍历 key，记录可获得的 `KeyWordItem`、record offset 和其他定位字段。
- 将定位信息序列化，关闭 worker/进程后重新打开文件，验证能否直接读取原记录。
- 若稳定 locator 不成立，验证 `term + ordinal -> lookupAll -> ordinal` 降级路径，确保重启后无需全量重新导入。
- 随机读取至少 1,000 条 MDX 记录和 1,000 条 MDD 资源。
- 确认 MDD 接口的 Base64 行为，并验证直接得到 `Buffer`/`Uint8Array` 的最小改造路径。
- 验证 OALDPE 的跨 MDD 分卷，以及 LDOCE5 的 MP3、SPX、CSS、JS、Base64 和重定向记录。
- 测量初始化耗时、峰值 RSS/heap、随机读取延迟，并验证损坏、截断和不支持格式的可诊断错误。

验收：结果与 Python 基线一致；locator 模式已经选定；两部词典的峰值内存边界明确；若需要薄封装或小型分支，改动范围已经量化。

### 阶段 2：Worker Thread 边界设计

目标：确定 Node 后端与 js-mdict worker 的最小稳定消息协议。

建议消息能力而非最终签名：

- `inspectDictionary(path)`
- `openDictionary(path)` / handle 生命周期
- `iterateEntries(handle, batchSize, cursor)`
- `readEntryAt(handle, locator)`，或 locator 不可用时的 `lookupAll(handle, term)`
- `iterateResources(handle, batchSize, cursor)`
- `readResourceAt(handle, locator)`，或按标准化 MDD key 定位
- `closeDictionary(handle)`

要求：

- 导入和大读取不阻塞 Electron 主线程。
- 支持取消、进度、批量返回和 backpressure。
- 错误必须可序列化，并保留文件、阶段和可诊断原因。
- 大二进制优先通过 transferable `ArrayBuffer`/`Buffer` 交付，避免无意义复制。
- 文件句柄、词典实例、worker、LRU 和崩溃重启生命周期明确。
- Node 主线程不解析 MDict 二进制格式；导入 Worker 使用独立 SQLite 写连接。

验收：Node CLI 通过 Worker Thread 完成真实词典索引和随机读取，不涉及 React。

### 阶段 3：SQLite 索引原型

目标：验证仅保存键和 locator 的数据模型。

- 建立 Dictionary、DictionaryFile、EntryIndex、ResourceIndex。
- 批量事务导入，避免逐条 insert。
- 同时保留原始键和规范化键。
- 支持单键多记录。
- 支持 LDOCE5 21 万以上别名记录。
- 增加导入中断、失败清理、恢复或重新导入策略。
- 测量 SQLite 数据库大小、导入时间和查询延迟。

验收：重启进程后无需重新导入索引；能够按稳定 locator 直接读取，或让词条按 `term + ordinal`、资源按标准化 MDD key 降级回查原始内容。

### 阶段 4：通用查询与重定向解析

目标：在 Node 层生成逻辑词条结果。

- 多记录查询。
- `@@@LINK` 递归解析。
- visited/cycle 防护和深度限制。
- fragment/anchor 保留。
- LDOCE5 target 清理适配器。
- 明确正文、隐藏资源节点和重复正文的组合顺序。
- 为损坏 link 返回部分结果和诊断，不让整次查询失败。

验收：`apple` 等样本能返回正文、内嵌图片依赖和所有必要记录；循环别名不会卡死。

### 阶段 5：自定义协议与沙箱渲染

目标：在 Electron 中忠实显示两部词典，但暂不追求完整产品 UI。

- 注册 `dictol-dict://`。
- 从外置文件、MDX、MDD 返回资源。
- 设置 MIME、CSP、缓存和 Range 行为。
- 使用独立沙箱页面运行词典脚本。
- 拦截 `entry://`、`sound://` 和外部 URL。
- OALDPE 验证 CSS、字体、折叠、配置、深色模式和 localStorage。
- LDOCE5 验证 HTML fragment 包装、别名图片、折叠、中文切换和离线 MP3。
- 验证词典切换后 origin、localStorage、缓存互不污染。

验收：代表词条的视觉和交互与成熟词典软件基本一致，词典页面无法访问 Node/Electron。

### 阶段 6：媒体兼容

目标：补齐音频和大资源传输。

- MP3 直接流式返回。
- SPX 按需解码，比较 Speex WASM、本机 FFmpeg 子进程与暂不支持三种路径，并确定缓存格式。
- 支持取消播放、重复播放和并发资源请求。
- 对大资源避免完整复制到多个进程。
- 决定是否实现 HTTP Range。

验收：OALDPE 与 LDOCE5 的代表性单词、例句、MP3、SPX 均可播放，内存没有随资源大小异常增长。

### 阶段 7：安全与网络权限

目标：把任意导入词典视为不可信内容。

- CSP 默认禁止外部脚本和任意网络。
- 词典级、域名级网络授权。
- 禁止 Node、Electron、文件系统和通用 IPC。
- 禁止任意窗口创建、下载和协议逃逸。
- 外部链接交给主应用确认后使用系统浏览器打开。
- 路径规范化和 MDD key 规范化安全测试。
- 对 HTML/JS 的崩溃、死循环和高 CPU 行为提供隔离与恢复。

验收：恶意测试词典不能读取本地文件、调用 Node、访问其他词典 origin 或绕过网络策略。

### 阶段 8：React 产品界面

目标：在底层链路稳定后构建桌面产品体验。

- 词典导入、校验、进度、取消和失败恢复。
- 搜索框、建议、历史、前进后退。
- 多结果和多词典结果组织。
- 词典启用/禁用、排序、删除索引但保留源文件。
- 缺失源文件重定位。
- 网络权限和词典设置界面。
- 诊断页显示解析器版本、文件状态和兼容性警告。

验收：完成端到端桌面应用工作流。

### 阶段 9：打包与回归

- 锁定 js-mdict 和压缩/解码依赖的准确版本与完整性。
- 验证 Electron 内置 Node 版本下的 ESM/CJS 兼容性。
- 验证 worker bundle 在打包后的路径、`asar`/`asarUnpack` 行为及源文件访问权限。
- 验证 macOS、Windows、Linux 的自定义协议、文件路径和可选 FFmpeg 可用性。
- app.userData 迁移和数据库 schema version。
- 大词典首次导入、升级、卸载和残留数据策略。
- 冷启动、导入、查询、资源读取和内存基准。
- OALDPE、LDOCE5 固定回归测试。

## 11. 第一批回归用例

### OALDPE

- `apple`：完整 HTML、CSS、JS、英美音频、插图、内部链接。
- `oaldpeconfig`：配置页面与 localStorage。
- `@topic_...`：特殊专题键。
- 重复键示例：`service station`，确认返回 6 条记录。
- 分卷验证：基础资源、`.1` 音频、`.2` 图片、`.3` 音频。

### LDOCE5

- `apple`：正文 + `@@@LINK=ldoce4188jpg` + Base64 图片节点。
- 普通 `entry://` 与带 fragment 的链接。
- MP3 英音、美音、例句发音。
- 任意 `.spx` 示例，例如 `\media\spx\GB_aleck0205.spx`。
- 最大深度 4 的别名，例如 `abridgments`。
- 循环别名：`cockfight`、`lipread`、`ghostwrite`。
- 含 HTML 的 link target：`add something on something`。
- 大小写行为：`apple` 与 `Apple`。
- 缺失 `LM5style_switch.css` 和 `LM5pp_config.ini` 时页面仍能初始化。

## 12. 关键风险与待决策事项

1. **原生实例生命周期**：当前已避免完整关键词索引常驻内存；下一步需要为已打开的 MDX/MDD 实例增加显式关闭和 LRU 上限。
2. **词典内容适配层粒度**：建议通用 MDict worker + 可插拔 Node 内容适配器，不把具体词典 HTML 规则写进底层解析核心。
3. **词典页面容器**：已选择独立 `WebContentsView`；后续重点验证跨平台 bounds、焦点、原生 View 与 React 浮层的 z-order。
4. **SPX 解码方案**：比较 Speex WASM、本机 FFmpeg 和第一版暂不支持，确认跨平台体积、性能及缓存格式。
5. **网络默认策略**：建议默认离线，逐词典授权；OALDPE 默认配置与此冲突，需要产品层明确提示。
6. **外置资源发现**：导入 MDX 时扫描同目录同 basename 资源，并记录缺失依赖，但不得盲目允许任意文件访问。
7. **SQLite 并发模型**：使用 WAL；主进程负责一般查询，按需导入 Worker 使用独立写连接，多个写任务仍需由 SQLite 串行协调。
8. **删除语义**：默认只删除 app.userData 内索引和缓存，不删除用户原始 MDX/MDD；删除源文件必须单独明确授权。
9. **版权与分发**：应用代码和词典内容严格分离。
10. **MDD 并发与大资源**：当前直接返回原始 `Buffer` 并并行查询多个 MDD；仍需为大资源和高并发请求设置上限，并评估 Range 支持。

## 13. 下一步建议

优先用 OALDPE 和 LDOCE5 进行应用内人工验收，记录 CSS、JS、图片、MP3、内部链接和重定向的差异。随后补齐 `@@@LINK` 多记录组合、导入进度/取消、词典实例 LRU、媒体 Range/SPX 与词典级脚本/网络策略，再进入跨平台打包和性能基准。
