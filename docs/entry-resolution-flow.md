# 词典查词与正文加载流程

## 索引与资源的职责

```text
SQLite
  └─ 词典元数据、源文件路径、dictionary_index 状态

DIDX
  └─ 规范化词头、原始拼写、MDX locator

MDX / MDD
  └─ 释义正文和资源文件
```

`dictionary_entry` 不再参与查词。本次升级保留历史表，并在对应词典成功建立 DIDX 后清理其旧记录；生词本、笔记和词典原文件不受影响。

## 候选词搜索

```text
SearchPanel
  └─ window.dictol.entries.search(prefix)
       └─ DictionaryEntryController.search
            └─ DBService.searchDictionaryEntries
                 ├─ DictionaryIndexManager.acquireMany(ready dictionaries)
                 └─ DidxQueryService.candidate
                      ├─ exact
                      ├─ loose
                      ├─ prefix
                      └─ fuzzy（普通候选为空时）
```

每个词典的 DIDX 由 `DictionaryIndexManager` 懒加载并缓存。多词典查询使用有界并发，结果在 Node 层按全局优先级归并、去重并截取最终数量。

通配符查询直接使用 DIDX `wildcard`；词形变化由 `WordFormService` 提供原型，再对 DIDX 执行 exact。

## 精确查找

```text
SearchResultPage / selection toolbar
  └─ window.dictol.entries.lookup(term)
       └─ DBService.lookupDictionaryEntryGroup
            └─ DidxQueryService.exact
                 └─ 返回命中的 dictionaryId
```

拼写不完全命中时，查询服务会继续执行 prefix，再执行 fuzzy，并将结果作为建议返回，不会自动替换用户输入。

## 正文加载

```text
dictol-entry://dictionary-{id}.dictol/_dictol-lookup?term=...
  └─ DictionaryResourceProtocolHandlers
       ├─ 再次对该词典执行 DIDX exact
       ├─ 收集全部匹配 locator
       ├─ MdictResourceManager.getEntryByLocators
       └─ MDX.readIndexRecord(locator)
            └─ 合并多个 physical record 的正文
```

URL 中保存的是词典 ID 和词形，而不是 SQLite 的 entry ID。这样索引可以重建，DIDX 的内部 ordinal、term 编号和 locator 仍然只属于索引内部，不会成为生词本或笔记的永久 ID。

词典内部的 `entry://word` 链接由 entry bridge 转换为新的词形查询；资源请求通过当前词典的隔离 origin 加载对应 MDD 文件。

## CSS 预览

CSS 编辑器的示例词条也通过该词典的 DIDX `wildcard('*', 1)` 取得，不再从 `dictionary_entry` 随机读取旧索引。
