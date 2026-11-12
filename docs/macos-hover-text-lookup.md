# macOS 光标取词流程

本文描述当前 macOS 普通查词和 AI 语境查词的实现。这里讨论的是光标下的文字，不是 `readAccessibleSelection()` 读取已选中文本的接口。

```mermaid
flowchart TD
    A[触发普通查词或 AI 语境查词] --> B[读取光标坐标]
    B --> C[macOS Accessibility]
    C --> D{结果可用？}
    D -- 是 --> E[词、词框；AI 模式还有上下文]
    D -- 否 --> F[截图和 macOS Vision OCR]
    F --> G{识别成功？}
    G -- 是 --> E
    G -- 否 --> H[显示识别失败]
    E --> I[词典或 AI 解释]
    E --> J[词框高亮]
```

## 1. 触发取词

普通查词和 AI 语境查词共用 [selection-toolbar.ts](../src/main/controller/selection-toolbar.ts) 的 `handleOcrShortcut()`：

1. 创建请求版本号并记录弹窗锚点，隐藏旧高亮。
2. AI 模式预热 explanation window。
3. 调用 `captureTextUnderCursor()`，先尝试 Accessibility，失败后再回退 OCR。

版本号用于丢弃过期结果，不会取消已经开始的原生 Accessibility 或 OCR 工作。

## 2. Accessibility 入口

[macos.ts](../src/main/accessibility/platforms/macos.ts) 获取当前光标坐标，调用原生模块 `readAccessibleText(x, y, includeContext)`：

- 普通查词传入 `includeContext = false`。
- AI 语境查词传入 `includeContext = true`。

Node 原生模块通常在工作线程执行 Accessibility 查询；如果坐标位于 Dictol 自己的窗口内，原生调用会切换到 AppKit 主线程。原生层通过 `AXUIElementCopyElementAtPosition` 获取命中元素，该元素可能是 `AXStaticText`，也可能是 `AXGroup`、`AXWebArea` 等容器。

原生层先检查辅助功能授权。未授权返回 `accessibility-not-authorized`，坐标命中调用报错返回 `hit-test:<AXError>`，两者都直接交给主进程回退 OCR。

仅在首次坐标命中满足下表条件时，工作线程才等待 20 ms，再以**同一坐标**调用一次 `AXUIElementCopyElementAtPosition`。

| 首次命中 | 重试原因日志 | 第二次命中后的处理 |
| --- | --- | --- |
| `AXWebArea` | `AXWebArea` | 仍是网页容器则返回 `AXWebArea: search-boundary` |
| `AXImage` 缺少有效位置或尺寸 | `bounds-unavailable` | 仍是图像则返回 `AXImage: image-content` |
| `AXImage` 的有效矩形未包含光标 | `image-bounds-miss` | 仍是图像则返回 `AXImage: image-content` |
| `AXStaticText` 缺少有效位置或尺寸 | `bounds-unavailable` | 若仍是静态文本，直接尝试词定位 |
| `AXStaticText` 的有效矩形未包含光标 | `static-text-bounds-miss` | 若仍是静态文本，直接尝试词定位 |

第二次以新命中的角色继续。首次命中的图像矩形包含光标时，直接返回 `AXImage: image-content`。首次静态文本和图像的节点矩形检查使用原始矩形，词框容差仅用于后续词定位。`invalid-character-range` 和词框未命中本身都不会触发等待。`AXVideo` 子角色按其角色走常规流程。

## 3. 查找词和词框

原生实现在 [accessibility.m](../native/accessibility/macos/src/accessibility.m)。从起始元素开始，代码尝试当前节点，再向内搜索子节点；仍未命中则逐层向父节点搜索。起始元素为深度 0，最多向上移动 10 次，到深度 10 为止。

每一层都先完成当前节点及其子树的查找，再读取父节点。祖先链上的 `AXWebArea`、`AXScrollArea`、`AXWindow` 和 `AXApplication` 都是停止边界，遇到即返回 `<角色>: search-boundary`。子树遍历单独判断边界，其中只显式跳过嵌套的 `AXWebArea`。

### 直接定位字符

对于 `title` 或 `value` 非空的当前节点，先尝试：

1. 使用 `AXRangeForPosition` 取得光标位置对应的字符范围。
2. 读取该字符附近的文本，用 `NLTokenizer` 找词；对于常见 ASCII 复合词字符，再扩展并修整词范围。
3. 使用 `AXBoundsForRange` 获取词框，验证光标是否命中。

词框判断向四周扩展 6 个 AX 坐标单位。对于跨行的词，会尝试检查字符矩形，避免把跨行包围框中的空白当作命中。

直接定位路径最多截取约 8192 个 UTF-16 代码单元的文本窗口；如果只能通过 `AXValue` 获取文本，可能先读取整个 value 再在本地截取。普通查词虽然不返回上下文，原生层仍需要读取文本来确定单词。

### 向内搜索子节点

直接定位失败后，先在当前节点尝试逐词回退（仅限有文本的 `AXStaticText` 和 `AXTextArea`），再按层遍历 `AXChildren`。子树中发现的文本节点直接走逐词查找，不再调用 `AXRangeForPosition`。若当前节点的 `AXRangeForPosition` 返回 `kAXErrorCannotComplete`，则本层跳过整个回退步骤，按祖先链的停止条件决定是否继续向上。

同一次命中测试中的各层子树搜索共用去重集合。对子节点的筛选规则如下。

- 节点的 `title` 和 `value` 都为空或不可用时，跳过节点自身取词和矩形检查，继续检查其子节点。
- 节点有文本时，读取 `AXPosition` 和 `AXSize`；矩形不可用或不包含光标时，跳过该子树。
- 通过矩形筛选的 `AXStaticText` 和 `AXTextArea` 立即尝试逐词查找，成功则立即返回；未命中时仍可继续搜索其子节点和其他分支。
- 其他通过筛选的节点进入队列，继续逐层搜索。

命中输入框（`AXTextArea`）或从其内部上溯到输入框时，先在控件自身和子节点内定位词。如果仍未找到，结束 Accessibility 查找并回退 OCR。

逐词回退使用 `NLTokenizer` 分词，从头逐个查询 token 的 `AXBoundsForRange`。token 框向四周扩展 3 个 AX 坐标单位用于筛选，最终词框仍需通过 6 单位容差的验证。该回退不处理超过 8192 个 UTF-16 代码单元的单节点文本。

**词定位的停止条件**

- 子树遍历读到一个节点有超过 100 个直接子节点时，跳过该节点的子树并继续搜索其他分支，不会因此结束整次词定位。恰好 100 个仍可搜索。
- 祖先链允许向上移动 10 次。深度 10 的节点仍可命中，常规搜索在这一层用尽时记录 `ancestor-depth-limit`。
- 首次命中、重试、祖先、子树及 AI 内联扩展共用 500 个不同节点的额度。子节点在角色和矩形筛选**之前**计数，包括随后被跳过的节点。定位词时遇到第 501 个不同节点，记录 `node-limit:500` 并回退 OCR。若只在 AI 扩展上下文时触及上限，则保留已命中的词和原节点文本。
- 单个节点可连续查询多个 token 或字符的矩形。代码在系统 AX 元素和祖先循环中的当前元素上设置 0.3 秒消息超时，整次查询没有总 deadline。

## 4. 原生返回值和上下文

普通查词返回词和词框：

```ts
{ word, x, y, width, height }
```

AI 模式额外返回 `text` 和 `offset`，其中 `offset` 是 `text` 内的 UTF-16 偏移。逐词回退返回的 offset 是命中 token 的起点，不一定是光标下的精确字符位置。

AI 模式命中 `AXStaticText` 时，原生层会尝试合并相邻内联文本，以处理链接、样式等造成的节点拆分：

- 仅在返回的文本与命中节点的完整 `AXValue` 归一化后一致时尝试合并。已截断的上下文窗口直接使用原结果。
- 从父节点开始，最多尝试 3 层。每次先尝试合并当前容器，成功即返回；失败时仅当当前容器的子角色以 `StyleGroup` 结尾才继续上溯。
- 单次合并最多访问 64 个节点，深度最多 4。可拼接的容器为 `AXLink` 和 `AXGroup`，嵌套的组还须是样式组。必须能表示所有子节点、找到目标且包含至少两个静态文本叶子。追加静态文本会检查累计长度是否超过 8192 个 UTF-16 代码单元。合并失败时保留原节点文本。
- `AXStaticText` 内部的 `\n` 替换为空格，保持 UTF-16 长度不变；独立 `AXLineBreak` 节点在合并时仍追加 `\n`。

## 5. 主进程接受 Accessibility 结果

[accessibility.ts](../src/main/ocr/accessibility.ts) 根据模式处理返回值：

- 普通查词取得词和词框后直接使用。
- AI 模式需要 `text` 和 `offset`，并调用 `sentenceContextAt()`。断句失败或得到的 `context` 与 `word` 完全相等时回退 OCR；一个完整句子即可使用，无需同时取得上下句。原生返回 `failure: null` 仅表示成功定位词，主进程仍会执行这一步。

[sentenceContextAt()](../src/main/ocr/ocr-text.ts) 使用 `Intl.Segmenter` 提取当前句和同一段落内最多各一句相邻句。它将 `\n`、`\r` 和 Unicode 段落分隔符作为边界，不跨段落补上下句。

## 6. OCR 回退

Accessibility 不可用时，[mac-ocr.ts](../src/main/ocr/mac-ocr.ts) 重新读取当前光标和所在显示器，并使用 macOS Vision 识别：

1. 普通查词以光标为中心请求约 `700 × 300` DIP 的截图区域。
2. AI 模式先取得显示器快照，从中裁出约 `1024 × 500` DIP 的区域，必要时复用同一帧。
3. 首次使用 Vision `accurate` 识别，语言列表包含英语、简体中文、繁体中文和日语。
4. AI 模式没有命中，或上下文不完整且触及截图边缘时，还可能扩大到约 `1280 × 650` DIP 并执行一次 `accurate` 识别。

单次 OCR 识别日志中的 `elapsedMs` 不包含完整的截图、可能的重试和弹窗流程。

## 7. OCR 取词与显示

[selectOcrTextHit()](../src/main/ocr/ocr-text.ts) 优先找包含光标的文本行，否则尝试寻找附近的行；优先利用 OCR 字符框定位字符，没有可用字符框时按文本行的视觉宽度估算。之后使用 `Intl.Segmenter` 分词、组装周边文本并断句，再将词框映射回屏幕坐标。

当前 OCR 路径即使在普通查词模式下也会调用 `sentenceContextAt()`；断句失败时 `selectOcrTextHit()` 返回空。普通查词不依赖上下文的提前返回目前只适用于 Accessibility 路径。

最终，普通查词启动词典查询，AI 模式发送词、当前句和上下文进行解释；两者都会请求绘制词框高亮。高亮绘制和 explanation window 的加载异步进行，不保证实际显示先后顺序。两条识别路径都失败时显示错误。

## 日志与验证

每次坐标命中成功都会打印 `initial hit`。同一次查词如果发生重试，会依次看到第一次命中、`initial hit retry reason`、`delayMs=20` 和第二次命中。原生失败串记录最后一次尝试沿祖先链遇到的失败与停止原因；`descendant-word-bounds-miss` 表示本层的子树查找没有返回词，不能据此还原逐个节点的访问记录。

主进程在原生 Promise 返回后打印 `[Accessibility] read Text Via macOS Accessibility API`。其中 `elapsedMs` 从调用原生模块前开始计时，包含排队、原生查找和实际发生的 20 ms 等待；后续断句、OCR 与弹窗耗时另计。见 [macos.ts](../src/main/accessibility/platforms/macos.ts)。

原生模拟检查可在 macOS 上运行：

```sh
clang -fobjc-arc -fblocks native/accessibility/macos/checks/ax-fallback.m \
  -framework ApplicationServices -framework Foundation -framework NaturalLanguage \
  -o /tmp/dictol-ax-fallback-test && /tmp/dictol-ax-fallback-test
```
