# opendict-rs 与 js-mdict 的 OALDPE 对照测试

测试日期：2026-07-23

测试词典：`Dictionaries/oaldpe`，包含一个 MDX 和四个 MDD：

- `oaldpe.mdx`：622,808 个关键词
- `oaldpe.mdd`：72 个资源
- `oaldpe.1.mdd`：160,805 个资源，`Encrypted="2"`
- `oaldpe.2.mdd`：1,874 个资源，`Encrypted="No"`
- `oaldpe.3.mdd`：112,897 个资源，`Encrypted="No"`

## 运行方式

需要 Node.js 22 和 Rust stable：

```bash
npm run mdict:benchmark -- Dictionaries/oaldpe
```

追加 `--json` 可以打印完整的机器可读结果：

```bash
npm run mdict:benchmark -- Dictionaries/oaldpe --json
```

每个解析器都在独立进程中运行。RSS 使用初始化前后的差值，避免把 Node 或 Rust 进程自身的基础内存算进解析器。首次执行时 Cargo 的编译时间不计入初始化耗时。

## 官方 opendict-rs 0.1.0

| 解析器            | 初始化耗时 | RSS 增量 | MDX 词数 |
| ----------------- | ---------: | -------: | -------: |
| js-mdict 7.0.0    | 2,548.8 ms | 174.9 MB |  622,808 |
| opendict-rs 0.1.0 |   595.1 ms | 113.7 MB |  622,808 |

这次运行中，opendict-rs 初始化约快 4.3 倍，RSS 少约 35%。不过这个 RSS 结果只包含成功加载的 MDX 和一个 MDD，不能代表四个 MDD 全部可用时的最终占用。

普通词条 `abandon`、`apple`、`run`、`take`、`zygote` 和重定向词条 `abandon_1` 的正文哈希完全一致。不存在的词条在两边都正确返回空结果。

`abandoned` 在 MDX 中有两个同名记录：一个 HTML 正文和一个 `@@@LINK=abandon` 重定向。js-mdict 的 `lookupAll()` 能返回两个记录，opendict-rs 目前只能返回其中一个。

前缀搜索能找到相同的候选词，但标点符号相关词条的排序不同。例如 `abandon_1` 与 `abandon's` 的先后顺序不同，应用层不能假设两个库的排序完全一致。

## MDD 兼容性

官方 0.1.0 只成功读取了加密的 `oaldpe.1.mdd`，因此只有其中的单词发音资源通过测试。其余 CSS、JS、图片和例句音频均查询失败。

具体错误是：

```text
invalid format: invalid encrypted field 'No': invalid digit found in string
```

原因是 opendict-rs 将 `Encrypted` 属性直接解析成数字，没有接受常见的 `Encrypted="No"` 写法。加载 MDD 时该错误只记录为 warning，随后跳过文件，并不会让整个词典初始化失败。

在临时源码中将 `No` 映射为 `0` 后再次测试：

- 四个 MDD 全部成功加载；
- CSS、JS、图片、单词音频、例句音频与 js-mdict 的 SHA-256 全部一致；
- 初始化约 708.0 ms；
- RSS 增量约 124.8 MB。

因此完整加载四个 MDD 后，相比同轮 js-mdict 的约 174.9 MB，内存降低约 29%，并不是官方示例中 90% 那么显著。原因之一是当前实现仍保存完整 `Vec<String>` 关键词列表，并为搜索建立额外的小写排序索引。

## 当前功能差异

opendict-rs Rust 核心支持 OALDPE 的 MDX 正文和 MDD 二进制资源，但 0.1.0 还不能直接替换 js-mdict：

- Node 绑定没有暴露 Rust 核心的 `lookup_resource()`；
- Node 绑定没有 `close()`；
- 没有等价于 `lookupAll()` 的重复词条接口；
- 没有 js-mdict 的 `contains()`、`suggest()` 和 `fuzzy_search()`；
- 前缀结果排序与 js-mdict 不完全一致；
- `Encrypted="No"` 会导致未加密 MDD 被跳过；
- 官方文档说明 MDict v1.2、StyleSheet/Compact mode 尚不支持。

`contains`、模糊搜索和跨词典排序可以由 SQLite 实现，因此不是关键阻碍。对 Dictol 真正需要补齐的是 MDD header 兼容、Node 资源查询接口、明确的实例释放接口，以及重复词条读取。

## 结论

opendict-rs 在 OALDPE 上的速度优势明显，完整资源加载后的内存改善约为 29%。解析核心能够返回与 js-mdict 完全一致的 HTML 和二进制资源，但当前 0.1.0 的 MDD 兼容 bug 和 Node API 缺口意味着现在不适合直接替换。

如果决定采用它，建议维护一个很小的 Dictol fork：先补齐上述四项，再用本 benchmark 作为回归测试。
