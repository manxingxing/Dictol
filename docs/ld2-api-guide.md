# Lingoes LD2 解析与 DIDX 索引

## 当前范围

Rust `Ld2` 和 Node `Ld2` 已支持项目中 7 部 LD2 样本的词头、原始 XML 释义、直接引用释义及 DIDX 构建/查询。此阶段提供底层 API；应用导入对话框、数据库格式登记、资源管理器及正文渲染尚未接入 LD2。

正文可能是含 HTML CDATA 的 XML，也可能是灵格斯专有 XML。`readIndexRecord()` 返回原始 XML 片段数组，不承诺返回可直接显示的 HTML。嵌入图片、音频及 `dict://res/` 资源暂未提取。

## Node API

```ts
import { Ld2 } from '@dictol/mdict-native'

const dictionary = await Ld2.open('/absolute/path/dictionary.ld2')
try {
  console.log(dictionary.entryCount)
  // 只在首次导入或需要重建时执行。
  const result = await dictionary.buildIndex('/absolute/path/index.didx')
  console.log(result.entryCount, result.fileSize)

  const index = await dictionary.openIndex('/absolute/path/index.didx')
  try {
    const candidates = await index.prefix('run', 20)
    const matches = await index.exact('running')
    for (const match of matches) {
      const xmlFragments = await dictionary.readIndexRecord(match.locator)
      console.log(match.keyText, xmlFragments)
    }
    console.log(candidates)
  } finally {
    index.close()
  }
} finally {
  dictionary.close()
}
```

`open`、`buildIndex`、`openIndex`、`readIndexRecord` 均在原生异步任务中运行。`close()` 与 MDX 使用同一生命周期约定：仍有在途任务时返回 `false`，应在任务完成后关闭。

`openIndex()` 使用抽样来源指纹和编码版本验证索引。DIDX 格式无需修改，精确、前缀、模糊、通配符查询复用现有实现。locator 是四字节小端词条编号，仅对相应来源索引有效，不应保存为生词本或笔记的永久标识。

## 文件布局和读取方式

LD2 包含描述区、词典区、压缩块目录及 zlib 数据块。解压后的逻辑空间依次为十字节记录表、词头区、XML 区。每条记录包含词头偏移、XML 偏移、标志字节和引用数量；词头前的四字节编号指向共享释义，末尾哨兵提供结束偏移。

解析器读取压缩头声明的块大小及偏移目录，按需解压请求覆盖的块，使用每部词典最多 2 MiB 的解压块缓存。构建索引只枚举记录表和词头；打开时会读取少量正文以判断编码，不会预先解压全文。

当前自动识别 UTF-8、UTF-16LE/BE。Rust `with_encodings(words, xml)` 可覆盖编码推断；其他编码尚未支持。所有七部样本已逐词验证解码，但不能据此保证所有 LD2 变体兼容。

格式研究参考：[KDictionary-Lingoes 原始实现](https://github.com/librehat/kdictionary-lingoes/blob/master/lingoes.cpp)。本实现根据文件布局及本地样本验证编写；不使用其全文解压、导出或剥离标记实现。

## 样本实测

2026-09-12，本机 release 构建；一次顺序运行，文件缓存可能影响结果。构建计时不包含打开 LD2 和后续全文验证。

| 词典                                      |  词条数 | 打开 ms |  构建 ms | DIDX 字节 |
| ----------------------------------------- | ------: | ------: | -------: | --------: |
| Britannica Pocket Encyclopedia            |  53,728 |    3.38 |   327.66 | 1,525,965 |
| 超级新华字典                              |  67,002 |    3.32 |   267.93 | 1,033,996 |
| Collins COBUILD 5th                       |  35,452 |    1.29 |   166.51 |   637,150 |
| Concise English Dictionary                | 190,981 |    3.18 |   979.43 | 3,876,831 |
| Longman Contemporary English              |  52,479 |    3.42 |   268.82 | 1,030,941 |
| Merriam-Webster Collegiate                | 219,623 |    0.86 | 1,058.38 | 3,761,423 |
| Oxford Advanced Learner's English-Chinese |  21,470 |    3.35 |   106.67 |   349,885 |

复现命令（索引输出到独立目录，不登记应用数据库）：

```sh
cargo run --release --manifest-path native/mdict/Cargo.toml \
  --example ld2_bench -- Dictionaries/lingoes /tmp/dictol-ld2-indexes
```

脚本逐词读取词头和原始释义，完整校验 DIDX，并抽样验证精确命中及 locator 回读。输出包含逐词典打开、构建、完整验证耗时和索引大小。
