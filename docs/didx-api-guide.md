# DIDX API 使用指南

适用：`feat/didx-index` 的 DIDX v3 / normalization v2。本文以 TypeScript 和 Node API 为主，示例基于当前导出的类型和集成测试。

## 1. 先选调用层

| 你要做什么                                     | 使用什么                                                 |
| ---------------------------------------------- | -------------------------------------------------------- |
| 输入时显示候选词                               | `DidxQueryService.candidate()`                           |
| 用户提交查询，获得精确结果、词形关联和拼写建议 | `DidxQueryService.lookup()`                              |
| 导入词典、打开或重建索引                       | `DidxImportService`                                      |
| 单独测试某部词典的索引                         | 原生 `DidxIndex`                                         |
| 从搜索结果读取 MDX 释义                        | 对应词典的 `Mdx.readIndexRecord()`                       |
| 以后适配新格式                                 | Rust `IndexSource`，或小规模验证用的 `DidxIndex.build()` |

**DIDX 查的是词头和正文位置，不返回释义 HTML，也不负责 MDD 图片、音频。** 搜索与读取正文分为两步。主应用的 MDX 导入和搜索 IPC 已使用这条链路；新格式适配器仍未接入。

## 2. 准备环境

在项目根目录完成依赖安装后构建原生模块：

```sh
npm run native:build
```

原生模块导入路径：

```ts
import { DidxIndex, Mdx } from '@dictol/mdict-native'
```

服务层文件位于 `src/main/`，下面服务示例的相对导入路径按代码放在 `scripts/` 下编写。可用 `node --import tsx scripts/你的脚本.ts` 执行。Electron 中应放在主进程调用，不要从 Renderer 直接加载原生模块。

所有示例里的 `/absolute/path/...` 都需要替换为实际绝对路径。索引输出必须是独立文件，不能使用 MDX/MDD 原文件路径。

## 3. 最小示例：构建 → 查词 → 读释义

以下函数可以直接放进项目脚本中，传入 MDX 与索引路径调用：

```ts
import { DidxIndex, Mdx } from '@dictol/mdict-native'

async function example(mdxPath: string, indexPath: string) {
  const mdx = Mdx.open(mdxPath)
  let index: DidxIndex | undefined
  try {
    // 首次导入或需要重建时执行；不要每次查词都构建。
    const built = await mdx.buildIndex(indexPath)
    console.log(built.entryCount, built.fileSize) // bigint

    // 验证索引对应这份 MDX 内容；MDX 指纹只读取大小和头/中/尾样本。
    index = await DidxIndex.openForMdx(indexPath, mdxPath)
    await index.validate() // 全量校验，在打开阶段做，不要每次查词都做。

    const matches = await index.exact('abandon')
    for (const match of matches) {
      const html = await mdx.readIndexRecord(match.locator, true)
      console.log(match.keyText, html)
    }
  } finally {
    index?.close()
    mdx.close()
  }
}

await example('/absolute/path/dictionary.mdx', '/absolute/path/index.didx')
```

不要只取 `matches[0]` 就认为拿到了完整释义：同一个词可能有多条物理记录。`readIndexRecord(locator, true)` 默认跟随 MDX 重定向；传 `false` 可读取未跟随重定向的内容。

日常使用应复用已经打开的 index 和 MDX reader，退出或移除词典时再关闭。

## 4. 原生查询 API

下面的 `index` 是已经打开的 `DidxIndex`。查询均返回 Promise，必须 `await`。

| 方法                                 | 用途与返回语义                                                 |
| ------------------------------------ | -------------------------------------------------------------- |
| `exact(query)`                       | 原始拼写优先，其次大小写等价；返回全部物理记录，无默认数量截断 |
| `loose(query, limit?)`               | 去重音、标点、空白后相同的其他拼写；不包含 exact 组            |
| `prefix(query, limit?)`              | 归一化后的前缀查询，每个归一化词组选一个代表，不是完整记录列表 |
| `fuzzy(query, maxDistance?, limit?)` | 编辑距离内的拼写建议；默认距离 2，最大 4                       |
| `wildcard(pattern, limit?)`          | 对完整词头做通配符匹配；每种原始拼写一个代表                   |
| `candidates(query, limit?)`          | exact → 大小写等价 → loose → prefix，数量不足再补 fuzzy        |

```ts
const exact = await index.exact('cafe')
const alternatives = await index.loose('cafe', 20) // 词典有 café 时可出现在这里
const prefixes = await index.prefix('abando', 20)
const suggestions = await index.fuzzy('definately', 2, 10)
const candidates = await index.candidates('definately', 20)
const subjects = await index.wildcard('p*ology', 50)
```

这里的结果取决于实际词典内容，不会凭空生成词条。

原生 `candidates()` 不解析通配符，也不查询词形表。需要自动识别通配符、查询词形关联时使用第 6 节的服务层。

### 返回对象

```ts
interface DidxMatch {
  keyText: string // 原始拼写，适合显示
  normalizedKey: string // 索引的搜索键，不要拿它替代显示词
  locator: Buffer // 适配器私有正文地址，不要自行解释
  keyOrdinal: bigint // 源文件物理词条序号
  matchKind: string
  distance?: number // fuzzy 结果才有
}
```

`matchKind` 当前可能是 `exact`、`case-insensitive`、`loose`、`prefix`、`fuzzy`、`wildcard`。前缀接口选出的代表如果正好等于输入，也可能标记为 exact/loose 等更准确的类型；应读取标签，不要仅按调用的方法猜测类型。

`locator` 和 `keyOrdinal` 只属于这份词典及当前索引，不是跨重建的永久 ID，不应当作生词本或笔记的主键。`bigint` 不能直接 `JSON.stringify()`；如需 JSON，可转换为十进制字符串，Buffer 转 base64，并在接收端显式恢复。

`openForMdx()` 的来源指纹不是完整文件 hash：它将文件大小和头、中、尾各 64 KiB 输入 XXH64（seed `0x4d445801`）。因此首次打开大 MDX 不会扫描全文，但极少数只修改样本之外内容的变化可能无法被指纹发现；正式索引仍由 `validate()` 做完整结构校验。

### 参数与字符规则

- 除 exact 外，数量默认 50、最大 10,000；`limit = 0` 返回空数组。原生参数应传非负整数。
- fuzzy/wildcard 输入最多 256 个 Unicode scalar；普通查询最多 65,536 UTF-8 字节。超限报错。
- 大小写采用 Unicode full case folding，原始精确等价采用 trim + NFC。
- `cafe` 与 `café` 不属于同一个精确组；去重音只用于 loose、归一化前缀和 fuzzy。
- 当前不提供英美拼写转换词库、繁简转换或正则查询。

## 5. 通配符写法

```ts
await index.wildcard('p*ology', 50) // *：零到多个字符
await index.wildcard('中?', 50) // ?：一个字符
await index.wildcard('caf?', 50) // 可匹配 cafe、café
await index.wildcard('a\\*b', 50) // JS 字符串转义后，匹配字面 a*b
await index.wildcard('a\\?b', 50) // 匹配字面 a?b
```

匹配覆盖整个词头，不是子串搜索；要搜包含 `bio` 的词，显式写 `*bio*`。通配符忽略大小写，但保留重音和标点，因此 `cafe` 模式不会匹配 `café`。

字符数量按 case folding 后的 Unicode scalar 计算，不按字素簇计算。例如 ß 会展开成 ss。以 `*` 开头的模式可能扫描整个词典，应避免在每次按键时无节制地发起查询；当前没有取消 API。

## 6. 应用层推荐入口：多词典查询

```ts
import { DidxIndex } from '@dictol/mdict-native'
import { DidxQueryService } from '../src/main/didx-query-service'
import { WordFormService } from '../src/main/word-form-service'

const index = await DidxIndex.openForMdx(
  '/absolute/path/index.didx',
  '/absolute/path/dictionary.mdx'
)
const forms = new WordFormService('/absolute/path/ecdict.sqlite')
try {
  await index.validate()
  const search = new DidxQueryService([{ dictionaryId: 74, index }], forms)

  // 输入阶段：候选和拼写建议。
  const candidates = await search.candidate('definately', 20)

  // 提交查询：分组返回，不自动替换用户输入。
  const result = await search.lookup('running', 50)
  console.log(candidates, result)
} finally {
  // DidxQueryService 不拥有 reader，调用方负责关闭。
  index.close()
  forms.dispose()
}
```

多部词典就在构造数组中添加多个 `{ dictionaryId, index }`。应用层每次查询从数据库读取 `status=ready AND enabled=true` 的词典，懒加载所需索引后新建服务实例；服务默认最多同时查询 8 部词典。

当前应用查询路径不使用 ECDICT；若独立调用服务需要词形关联，才显式传入 `WordFormService`。

### lookup 返回分组

```ts
type DidxLookupResult = {
  query: string
  exact: DictionaryDidxMatch[]
  relatedForms: Array<{ form: string; matches: DictionaryDidxMatch[] }>
  loose: DictionaryDidxMatch[]
  suggestions: DidxCandidate[]
  wildcard: DidxCandidate[]
}
```

| 字段           | 界面应该如何使用                                                            |
| -------------- | --------------------------------------------------------------------------- |
| `exact`        | 读取并展示原输入词的释义；保留各词典和重复记录                              |
| `relatedForms` | 单独显示“相关原型”；只有已启用词典存在该原型才返回                          |
| `loose`        | 单独显示拼写变体，不冒充精确命中                                            |
| `suggestions`  | exact 为空时的候选建议，可能包含 loose、prefix、fuzzy；不是全部自动纠错结果 |
| `wildcard`     | 输入含 `*` 或 `?` 时使用，其余结果组为空，跳过词形关联                      |

例如 `saw` 可以同时在 exact 中有自己的词条，在 relatedForms 中关联 `see`。`running`/`ran` 可关联 `run`，`mice` 可关联 `mouse`。词形关联只发生在 `lookup()`，输入阶段的 `candidate()` 不查询词形表。

`lookup(query, limit)` 的 limit 不截断 exact 和每个原型的精确记录；loose 是跨词典总上限，按传入词典顺序收集。suggestions/wildcard 是合并排序后的候选上限。服务层把有限数值 limit 向下取整并限制在 0–10,000，非有限值抛错。

## 6.1 应用级索引容器

主进程的 `AppRuntime` 挂载 `dictionaryIndexManager`。它在应用启动时只从数据库读取所有登记的 MDX 词典目录，按 `dictionary.uuid` 找到 `dictionary-index/<uuid>/index.didx`。真正的文件打开和来源指纹检查会延迟到第一次 `acquire()`，首次查询只做 DIDX header/目录校验；完整 `validate()` 留在构建、重建和离线维护路径，避免阻塞首次查询或应用启动。

```ts
// AppRuntime.initialize() 完成后使用
const manager = runtime.dictionaryIndexManager
const oaldpe = await manager.acquireRequired(74)
const result = await oaldpe.index.candidates('definately', 20)
```

可用方法：

```ts
manager.get(dictionaryId) // 只读取已加载索引，不触发 I/O
await manager.acquire(dictionaryId) // 首次使用时打开并校验
await manager.acquireRequired(dictionaryId) // 不存在或打开失败时抛错
await manager.acquireMany(dictionaryIds) // 默认最多8部同时加载
manager.list() // 数据库中的全部索引描述
manager.getAll() // 当前已经加载的索引
```

分组查询服务只引用 `manager.acquireMany(dictionaryIds)` 返回的索引，不应再次调用 `DidxIndex.open()`。查询服务默认最多同时查询 8 部词典；索引容器拥有这些 reader；应用退出时由 `AppRuntime.dispose()` 统一关闭。单个分组服务销毁时不要关闭共享的 `DidxIndex`。

启动阶段只会读取数据库目录，因此不会因为未使用的词典索引缺失而阻塞启动。首次 `acquire()` 时，如果索引文件缺失、来源文件变化或 header/目录校验失败，该词典的查询 Promise 会失败；索引需要先通过导入/构建流程生成，容器本身只负责打开和来源校验，不在查询阶段重建索引。块 checksum 会在实际访问块时校验；需要全量检查时显式调用 `validate()`。

### 候选与正文的区别

`DictionaryDidxMatch` 比原生结果多一个 `dictionaryId`。`DidxCandidate` 还包含 `dictionaryIds: number[]`，表示该候选在本次各词典返回的结果中出现的来源，不是全库命中总数。

多词典候选按不区分大小写的规范化 key 合并；`dictionaryId` 和 locator 属于被选中的代表词条。点击候选后，若要加载全部词典释义，应重新 `lookup(candidate.keyText)`，再按每条结果的 `dictionaryId` 选择对应的 MDX reader，调用 `readIndexRecord(match.locator)`。不要用同一个 MDX reader 解码所有词典的 locator。

## 7. 导入与自动重建

一般不要手工维护索引版本、UUID 路径和状态表，使用导入服务。下面示例会写入你指定的应用数据库，因此先在独立测试目录试用。

```ts
import { DidxImportService } from '../src/main/didx-import-service'
import { initDrizzleDB } from '../src/main/db/drizzle'

const databasePath = '/absolute/path/test-data/dictol.sqlite'
const indexRoot = '/absolute/path/test-data/indexes'
const mdxPath = '/absolute/path/dictionary.mdx'

// 应用初始化时执行迁移；父目录需事先存在。
const initialized = initDrizzleDB(databasePath, '/absolute/path/Dictol/drizzle')

// 服务复用连接；调用方在所有任务完成后负责关闭。
try {
  const importer = new DidxImportService(initialized.orm, indexRoot, 2)
  const imported = await importer.importOne({
    mdxPath,
    name: '测试词典',
    sourceFiles: [{ sourcePath: mdxPath, relativePath: 'dictionary.mdx' }]
  })

  console.log(
    imported.dictionaryId,
    imported.dictionaryUuid,
    imported.indexPath,
    imported.indexElapsedMs
  )

  // 维护时按需重新构建；正常查询使用 DictionaryIndexManager 懒加载。
  await importer.rebuild(imported.dictionaryId)
} finally {
  initialized.db.close()
}
```

`importOne()` 是独立维护服务的导入入口，正常应用导入由 Worker 负责。迁移与手动重新索引调用 `rebuild(id)`，始终重新构建，并更新 `dictionary_index` 元数据；它不参与日常查询，也不返回已打开的索引。批量维护还可使用 `scripts/build-user-didx.mjs`。

索引路径为 `indexRoot/<dictionary.uuid>/index.didx`。源文件仅登记位置，不复制。`sourceFiles` 应包含 MDX，以及需要登记的关联源文件；MDX 正文和 MDD 资源仍由原文件负责。

`rebuild()` 依赖 Rust 在发布文件前执行的完整校验，不再额外打开索引并重复校验。构建采用 `.tmp` 校验后替换正式文件；构建失败保留旧正式索引，不删除其他构建任务的临时文件。读取不到源文件时会报错。

批量导入使用 `await importer.importMany(requests)`：默认最多两个并发任务，结果与输入顺序一致，每项分别是 `{ status: 'ready', result }` 或 `{ status: 'error', error }`。`importOne()` / `rebuild()` 失败则抛错。

### 应用内的文件夹批量导入

词典管理页的“扫描文件夹导入”使用两步 IPC：

```ts
const preview = await window.dictol.dictionaries.selectFolder()
if (preview) {
  const imported = await window.dictol.dictionaries.importFolder({
    rootPath: preview.rootPath,
    copyFiles: true
  })
  console.log(imported.map(({ id, name }) => ({ id, name })))
}
```

扫描会递归查找 `.mdx`，但每个 MDX 只发现所在目录中的 `.mdd`、图片、CSS、JavaScript 和字体等伴随资源，不递归子目录。已经存在于 `dictionary.dict_path` 的词典目录会被排除，因此重复扫描同一目录时只导入新增目录中的 MDX，实现增量导入。两个未被排除的 MDX 不能位于同一目录；父子目录中的 MDX 是允许的，因为批量扫描不会让父级 MDX 获取子目录资源。导入接口会先创建 `dictionary`、`dictionary_file` 和 `dictionary_index` 记录，然后立即返回 `importing` 词典；复制文件和 DIDX 构建由主进程队列以最多两个 Worker 并发执行。

## 8. 新格式的通用构建入口

Node 的通用构建入口适合小数据验证；大词典应在 Rust 实现 `IndexSource`，避免几十万词条通过 JS 边界传递。

```ts
import { DidxIndex } from '@dictol/mdict-native'

await DidxIndex.build(
  [
    { keyText: 'hello', locator: Buffer.from([0, 1]) },
    { keyText: 'world', locator: Buffer.from([0, 2]) }
  ],
  42n, // 仅为演示；实际必须由来源内容与 locator 编码版本确定
  '/absolute/path/custom.didx'
)

const index = DidxIndex.open('/absolute/path/custom.didx')
try {
  await index.validate()
  console.log(await index.exact('hello'))
} finally {
  index.close()
}
```

`build()` 返回统计对象，不返回已打开的 index。fingerprint 必须在 unsigned 64-bit 范围内，源内容或地址编码规则变化时必须改变。每个 locator 长度 1–4,096 字节；含义由适配器决定。上例 locator 不是 MDX 地址，不能传给 `Mdx.readIndexRecord()`。

`DidxIndex.open()` 是同步低层接口，不核验来源指纹，也不代替全量 `validate()`。通用格式适配器要自己校验 `index.metadata.sourceFingerprint`；Rust 可用 `DidxIndex::open_for_source(path, fingerprint)`。MDX 应优先使用 `openForMdx()` 或导入服务。

## 9. 生命周期与错误处理

- 先 await 当前任务，再 close reader。查询、构建、校验是异步任务；`Mdx.open()`、低层 `DidxIndex.open()`、metadata 和 close 是同步接口。
- 有任务持有 reader 时，`close()` 返回 false，不能据此认为资源已释放；等待任务结束后再次关闭。已经关闭的 reader 不再可查询。
- 参数错误可能同步抛出，文件/任务错误可能导致 Promise reject；将调用和 await 一起放在 try/catch 中。
- 不要在 reader 打开期间原地修改或截断源文件。切换词典文件时应结束任务、关闭 reader，再重新打开并核验索引。
- `DidxQueryService` 中任一词典查询失败会使本次调用失败，目前不会自动吞掉错误并返回部分词典结果。
- 目前没有流式查询分页、查询取消或 UI 防抖。输入框集成时仍需处理防抖和旧请求结果覆盖新查询的问题。

## 10. 可参考的测试与设计

- [真实 API 与词形库集成测试](../scripts/didx-search-integration.test.ts)
- [多词典查询服务测试](../scripts/didx-query-service.test.ts)
- [导入和重建测试](../scripts/didx-import-service.test.ts)
- [原生类型声明](../native/mdict-node/index.d.ts)（由构建生成，不手工修改）
- [当前 DIDX v3 设计、文件布局与性能记录](./didx-v3.md)
