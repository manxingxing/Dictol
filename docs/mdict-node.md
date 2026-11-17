# MDict Node.js binding

`native/mdict-node` 使用 napi-rs 将新版 `native/mdict` 暴露给 Electron main process。renderer 不直接加载原生模块，仍通过 Node 后端和 IPC 使用词典能力。

## 构建

```bash
npm install
npm run native:build
```

构建会为当前平台生成 `.node` 文件以及 `index.js`、`index.d.ts`。应用的 `dev` 和 `build` 命令会先执行本机绑定构建。跨平台安装包必须在相应平台或交叉编译环境中分别构建。

## API

```ts
import { Mdx, Mdd } from '@dictol/mdict-native'

const dictionary = Mdx.open('/path/to/dictionary.mdx')
console.log(dictionary.metadata)

const scanner = dictionary.keys()
while (true) {
  const { entries, done } = await scanner.nextBatch(2_048)
  // 将当前 entries 批量写入 SQLite。
  if (done) break
}

// scanner 也支持逐条异步遍历。
for await (const entry of dictionary.keys()) {
  console.log(entry.keyText)
}
```

每个词条包含：

```ts
interface DictionaryEntry {
  keyText: string
  recordStart: bigint
  recordEnd: bigint
}
```

偏移使用 `bigint`，避免 JavaScript `number` 的整数精度限制。不得在同一个 scanner 上并发调用 `nextBatch()`；不同 scanner 或不同词典可以独立工作。

读取正文或 MDD 资源：

```ts
const bytes = await dictionary.readRecord(entry.recordStart, entry.recordEnd)

const resources = Mdd.open(['/path/to/dictionary.mdd', '/path/to/dictionary.1.mdd'])
const resourceEntry = await resources.findKey('\\media\\icon.png')
const resourceBytes = resourceEntry
  ? await resources.readRecord(
      resourceEntry.volume,
      resourceEntry.recordStart,
      resourceEntry.recordEnd
    )
  : null
```

`nextBatch()` 和 `readRecord()` 都通过 libuv worker pool 执行文件读取和解压，不阻塞 Node.js 主线程。

## 当前导出

- `Mdx.open(path, options?)` / `Mdd.open(paths, options?)`
- `dictionary.metadata`
- `dictionary.keys()` / `dictionary.entries()`
- `scanner.nextBatch(batchSize?)`
- `Mdx.findKey(word)` / `Mdd.findKey(word)`
- `Mdx.readRecord(start, end)` / `Mdd.readRecord(volume, start, end)`
- `Mdx.readRecordText(start, end, redirectLink)`（文本、StyleSheet 和可选 LINK 展开）
- `Mdx.lookupText(word)` / `Mdd.lookup(word)`

MDD 的 `paths` 必须由调用方显式传入，顺序就是分卷优先级；MDD key 位置额外包含 `volume`，因为 offset 相对于对应物理分卷。

`open` 支持覆盖新版 `native/mdict` 的安全限制、LRU 缓存容量以及 v1/v2 注册凭据。默认 batch size 为 2,048，单批最大 100,000。

## 测试

```bash
npm run native:test
```

测试会通过 Node-API 完整遍历 OALDPE MDX、读取并校验一个真实 record，同时检查加密 MDD 的元信息和批量扫描。
