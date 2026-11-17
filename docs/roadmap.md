# Dictol 后续待办事项

本文记录尚未实施的产品、检索和 Rust 解析层工作。具体优先级和方案在实施前再评估。

## 界面与交互

- [x] 收紧整体界面布局，减少界面元素之间的空隙，在保持可读性的同时提高空间效率。
  - [x] 缩窄 sidebar。
  - [x] 收紧 `SearchPage` 结果列表，适当减小 padding。
- [x] 将多词典 tab 改为相互独立的胶囊形状，增加活力感。
- [x] `Cmd+F` 聚焦后自动选中输入框中的全部单词。
- [x] 支持页面内查找。
- [x] 在主窗口按 ctrl+shift+f也应该触发页面内搜索，仅在searchPage内监听键盘事件
- [x] 改善 Windows 下 title bar 的外观。
- [x] 断网后，AI查询没有在界面上返回错误
- [x] AI流式响应返回了错误高亮的问题
- [x] search popover 适配苔绿主题
- [x] 切换应用后，selection toolbar没有自动消失
- [x] ?term 变更后，同步修改 search Query
- [ ] 整理 200 限制，只限前端，不限后端

## 词典与检索能力

- [ ] 确定 `normalized word` 的规范化规则：是否去除特殊字符和内部空格；同时评估大小写、Unicode 规范化、连字符和词典原始 `StripKey` 规则的关系。
- [x] 支持在线词典，并将在线词典候选项放在候选词列表底部。
- [ ] 设计并实现高级检索能力：
  - [x] `glob` 查询。
  - [ ] 相近词查询。
  - [ ] 词性还原。
  - [ ] 近似词查询。
- [ ] 内置词典 ecdict或者其他
- [x] 支持收藏（生词本）。
- [x] 支持将多个生词本导出为 Excel，每个生词本对应一个 sheet。
- [x] 使用了取词组时，从弹窗切换到主窗口时，也要切换主窗口的查词组为对应的取词组
- [x] 制作 aictionary 内容为 mdx，仿照原排版风格

## Rust 解析层与工具

- [x] 将 Electron 使用的 Rust 解析层切换到 `native/mdict`。
- [x] 让 `native/mdict` 暴露一个二进制 CLI，提供 MDX/MDD 文件检查能力。
- [x] v2 版支持加密，预计要接受一个 reg_code 参数
- [ ] cli 添加命令，提供返回 mdx 词条的raw 内容，不follow link

## AI 查词

- [x] 添加侧边 drawer，显示 AI 查词结果。
- [x] 在设置页面支持选择 AI 服务供应商。
- [x] 在设置页面配置并安全保存 API key。
- [x] 测试本地千问模型的ai能力 (ollama)
- [x] 使ai功能支持更多的 provider/model，不再硬编码 thinking: disabled

## 多翻译服务商
https://bobtranslate.com/service/
https://bobtranslate.com/guide/advance/service.html

- [x] 接入 Google 翻译， Microsoft 翻译， 火山翻译， DeepL 翻译
- [x] 智谱 GLM, Bilibili 免费公开翻译 API，OpenAI compatible


## mac 平台 OCR 取词和 OCR AI 解释
有两个文档供参考:
docs/near-word-analysis.md
docs/macos-ocr.md

有一个开源实现供参考 https://github.com/xyizhan/flow-translate 。这是swift的实现，但是可以参考其实现思路，尤其是选区扩展，从区域中判断当前hover的单词所在的整句。

当前 macOS OCR 通过项目内的原生 addon 调用 Apple Vision 实现。

验收标准:
1. 配置页面-取词里，添加一个 OCR 取词的开关，打开时允许配置两个快捷键。一个是查词快捷键，默认是 opt+s，一个是AI解释快捷键，默认是 opt+t
2. 查词流程
  1) 在任意软件的文字上方按下opt+s，调用 apple vision ocr 获取鼠标下的文本
  2) 弹出查词弹窗(explanation window)，显示词的查词结果
3. AI 解释流程
  1) 在任意软件的文字上方按下opt+t，调用 apple vision ocr 获取鼠标下的文本
  2) 设计一种算法，获取鼠标下单词所在的整句，上一句和下一句，不超过段落开头和末尾
  3) 弹出一个新的弹窗，调用 AI 查询整句的意思，并让AI重点解释光标下单词在句子里的意思。让AI 以json格式返回，前端以良好格式渲染。
  4) 弹窗的 titlebar 上显示一个摘抄的按钮，点击时创建 dictionaryNote，以原文为 excerpt, 以AI解释为 comment, 光标下的词为 relatedTerms

## build流程
- [x] 提交 mdict-node 的 .node 脚本
- [x] 拆分build脚本，分别build native, build app。后者直接使用 .node 文件
- [ ] 如何利用 github action?

## TTS 服务商
- [ ] Microsoft 语音合成
- [ ] Open-AI compatable
- [x] 系统 TTS

## ocr 服务商
- [ ] 本地 paddleOCR

## 摘抄和笔记
- [x] 词典内摘抄
  - [x] 自动和当前词关联
- [x] 词典外摘抄
  - [x] 需要手动选取关联词，可以有多个
- [x] 可能要支持全文搜索
  - [x] 搜索关联词、摘抄
  - [x] 使用 sqlite 内置功能
- [ ] 笔记本
- [ ] 单词卡
    是在生词本，还是摘抄？

## 服务和共享
- [ ] 局域网 web service
- [ ] mac dictionary bridge，提供词典服务给苹果词典

## 缓存管理
- [x] 仅缓存体积大于 20k 的资源(尤其是字体)
  - [x] 获取mdd资源拆分成两步，第一步获取位置，第二步提取内容
  - [x] 缓存检查放在两部之间，而不是最前面

## license 和
- [ ] 关于 - 开源许可
  - [ ] selection-hook
  - [ ] jieba-rs

## 性能优化
- [ ] 缓存重写过的 css，避免重复处理
  先了解有没有缓存再决定。有时候浏览器也有缓存，在一个会话里，效益可能并不明显


## 待进一步确认的问题

- [x] 明确页面内查找的范围：当前词条、当前词典、全部已打开词典，还是仅查找已渲染文本。
- [x] 明确在线词典的请求时机、缓存策略、网络错误提示和隐私边界。
- [ ] 明确 glob、相近词、词性还原和近似词之间的查询语义及排序规则。
- [ ] 明确生词本导出的字段、重复词处理、HTML 清理和 Excel 文件格式要求。
- [x] 明确 AI 供应商适配层、请求上下文、流式响应和 API key 的本地存储方案。
