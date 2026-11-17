# MDX / MDD 文件探索

项目提供了 `inspect-mdict.mjs`，用于在不启动 Electron 的情况下探索词典结构。解析器使用 `js-mdict`；MDX 支持查词和关键词索引，MDD 支持资源定位。

## 基本命令

```bash
npm run mdict:inspect -- <file> [command] [arguments]
```

查看 MDX/MDD 的头信息、版本、编码、压缩和关键词数量：

```bash
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdx info
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdd info
```

查看原始 header：

```bash
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdx header
```

查看关键词及其 record 位置：

```bash
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdx sample 10
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdx keys 100 20
```

查询 MDX：

```bash
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdx lookup abandon
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdx prefix aband
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdx contains phon 30
```

定位 MDD 资源：

```bash
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdd locate '\\css\\dict.css'
npm run mdict:inspect -- Dictionaries/oaldpe/oaldpe.mdd locate '\\css\\chinese.css'
```

脚本只打印释义的长度和前 1000 个字符，避免终端输出整篇 HTML。`info`、`sample` 和 `keys` 只读取索引，不会把词条 HTML 写入数据库。
