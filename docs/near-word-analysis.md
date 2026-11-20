
## NearWord 分析

NearWord 的核心不是“读网页里的文字”，而是“用户触发时截一帧屏幕，在本机识别文字，再查本地词典”。因此它能在 PDF、图片、游戏和字幕上使用，也不要求文字可选中。联网 AI 是可选的第二条处理链。 [产品说明](https://nearword.app/features) [数据与安全说明](https://nearword.app/security)

## 推测的查词流程

```text
全局快捷键或 Force Click
          ↓
捕获当前屏幕的一帧
          ↓
本机 OCR 识别文字和位置
          ↓
用指针位置确定目标词
          ↓
查本地词典 ──→ 原生结果面板
          └────→ 可选 AI Context
```

- **触发与捕获**：macOS 文档要求授予辅助功能和屏幕录制权限；产品说明称每次查询只捕获一帧，没有后台录屏。macOS 还支持触控板 Force Click。
- **本机 OCR**：NearWord 的更新记录称，Mac 版把截图和 Apple Vision OCR 放在应用进程内处理，不经过临时图片文件或辅助进程。它早期也做过基于 Rust、PaddleOCR 和 ONNX Runtime 的 OCR 管线；记录称这套独立引擎仍是 Windows/Linux 开发的基础。
- **命中目标词**：根据“指向屏幕上的词再按快捷键”的交互，较可能的实现是用鼠标位置与 OCR 结果中的文字区域配对，再确定要查的词或短语。官方资料没有公开这部分的算法细节，所以这是基于产品行为的推断。
- **离线查词**：用户下载词典包后，本机可离线查词。词典包有独立的构建流程和版本目录；官方没有说明内部使用的索引格式或具体匹配算法。
- **显示与记录**：结果可显示在原生风格的 Mac 面板中；更新记录称该面板使用 AppKit，并能让原应用保持在前台。查询历史、截图和词典保存在本机；历史曾迁移到 SQLite，并使用压缩缩略图。 [NearWord 更新记录](https://nearword.app/changelog) [macOS 使用文档](https://nearword.app/docs?platform=macos)

## AI 与数据流

本地词典查询与 AI Context 是两条不同的数据路径。AI Context 需要联网；安全说明称，开启后会发送目标词或短语、附近识别文本、语言设置，以及可用时的应用名。如果本机 OCR 失败，才会附上裁剪图像。更新记录还称 AI 和词典结果可以并行加载，AI 回答会逐步显示。 [数据与安全说明](https://nearword.app/security) [更新记录](https://nearword.app/changelog)

有一处文档信息需要留意：安全页称查询内容不会被 NearWord 或其 AI 服务保存；但 macOS 使用文档又称 AI 请求和回答会保存在服务器历史与日志中，且没有自动过期时间。两处表述不一致，单凭公开资料无法确认当前实际的数据保留策略。 [安全页](https://nearword.app/security) [macOS 使用文档](https://nearword.app/docs?platform=macos)

## 技术栈与产品边界

更新记录给出的演进路线是：早期 Mac 原型使用 SwiftUI；随后以 Tauri、Rust 和 Svelte 探索跨平台；之后形成 Rust 共享应用基础，并引入 GPUI 和 macOS 原生能力。当前公开信息显示，Mac 有完整查词功能，Windows 处于 beta；Linux 页面则称查词尚未开放。官网记录还称网站基于 SvelteKit，但这只能确认其公开披露过的建站技术，不能当作对当前网站代码的验证。 [NearWord 更新记录](https://nearword.app/changelog) [Linux 文档](https://nearword.app/docs?platform=linux)

整体设计重点是：**用系统级捕获覆盖无法选中文本的内容；把 OCR、词典和历史尽量留在本机；把联网 AI 做成可关闭的增强功能。**以上依据是 NearWord 的公开文档和更新记录，并非对其源码或安装包的逆向分析。
