# 悬停取词的 Accessibility 实现

两张图覆盖 `readAccessibleText(x, y, includeContext)` 及 Node 主进程的上下文处理。`includeContext = false` 用于普通查词，`true` 用于 AI 语境查词。`text` 的 `offset` 以 UTF-16 代码单元计数。

## macOS Accessibility

```mermaid
flowchart TD
    A[Node 读取鼠标屏幕坐标<br/>调用 readAccessibleText] --> B{已授予辅助功能权限?}
    B -->|否| FAIL[返回失败<br/>主进程回退 OCR]
    B -->|是| C[AXUIElementCopyElementAtPosition<br/>获取首次命中节点]
    C --> D{首次命中需要重试?}
    D -->|AXWebArea / AXScrollArea，或 AXStaticText / AXImage 的矩形无效或未包含光标| E[等待 20 ms<br/>以相同坐标重新命中一次]
    D -->|不需要| F[检查当前节点角色]
    E --> F
    F --> G{到达搜索边界或命中图片?}
    G -->|是| FAIL
    G -->|否| H{节点有 value 或 title?}
    H -->|是| I[AXRangeForPosition<br/>从屏幕坐标获取字符范围]
    H -->|否| W[按层选择下一个通过筛选的子节点]
    I --> J{字符范围有效?}
    J -->|是| K[在完整 AXValue 中定位词]
    K --> L[NLTokenizer 定位包含字符的词<br/>扩展并修整 ASCII 复合词]
    L --> M[AXBoundsForRange 获取词框<br/>用扩展 6 单位的矩形校验光标]
    M --> N{词框命中?}
    N -->|是| X{词是否跨行?}
    X -->|是| Y[查询字符框<br/>校验命中并合并光标所在行的字符框]
    X -->|否| HIT[得到词、词框和节点内偏移]
    Y -->|命中| HIT
    Y -->|未命中| S
    J -->|一般失败或范围无效| S
    J -->|AX 通信失败| COMM{当前是子树候选?}
    COMM -->|是，跳过该分支| W
    COMM -->|否| P
    N -->|否| S
    S{当前节点支持逐词回退?} -->|是| T[对 AXStaticText / AXTextArea 的 value 分词<br/>最多处理 8192 个 UTF-16 代码单元<br/>逐 token 查询 AXBoundsForRange]
    S -->|否| W
    T --> U{token 扩展 3 单位后包含光标?}
    U -->|是| V[扩展到完整词<br/>查询词框并按 6 单位容差与跨行规则验证]
    V -->|命中| HIT
    U -->|否且还有 token| T
    U -->|候选 token 用尽| W
    V -->|未命中且还有 token| T
    V -->|未命中且 token 用尽| W
    W --> Z{还有候选子节点?}
    Z -->|是，同样先直接定位字符| I
    Z -->|否| P{可以继续向父节点搜索?}
    P -->|是，读取父节点| F
    P -->|否| FAIL
    HIT --> CTX{includeContext?}
    CTX -->|false| OUT[返回 word 和屏幕词框]
    CTX -->|true| C1[直接定位命中后扩至最多 8192 单位上下文<br/>保留 text 和 offset；AXStaticText 内换行替换为空格]
    C1 --> C2{AXStaticText 的完整 value<br/>与返回文本一致?}
    C2 -->|是| C3[最多尝试 3 层父节点<br/>按顺序合并可表示的内联文本]
    C3 --> C4{合并成功?}
    C4 -->|是| C5[加入前方兄弟文本长度<br/>修正 offset]
    C4 -->|否| C6[保留原节点 text 和 offset]
    C2 -->|否| C6
    C5 --> NODE[返回 word、词框、text 和 offset]
    C6 --> NODE
    NODE --> JS[Node 按段落边界和 Intl.Segmenter 断句<br/>取当前句及段内最多各一句前后句]
    JS --> OK{断句成功且 context 不等于 word?}
    OK -->|是| AI[返回词、词框、当前句和上下文]
    OK -->|否| FAIL
```

- 搜索子树采用逐层遍历。空文本容器继续展开，有文本的子节点先按节点矩形筛选。通过筛选后，与首次节点、父节点共用“直接字符定位 → 必要时逐词回退”的路径。子节点通信失败时跳过该分支、继续其他候选。超过 100 个直接子节点的分支被跳过，继续搜索其他分支。搜索祖先最多向上 2 层，各子树合计最多遍历 500 个不同子节点；命中节点与向上查找的祖先不计入。`AXWebArea`、`AXScrollArea`、`AXWindow` 和 `AXApplication` 是祖先搜索边界。
- 节点 value 在定位与上下文扩展中复用，token 与词范围相同时复用矩形。直接定位在完整 `AXValue` 上分词；没有 value 或字符偏移越界时直接定位失败。AI 命中后才截取最多 8192 单位上下文。逐词回退保留 8192 单位输入上限。所有命中统一组装结果和扩展上下文，重试不生成中间 JSON。
- 图中逐词回退的 `offset` 是命中 token 的起点。直接字符定位路径的 `offset` 对应命中字符。词首或词尾的字符框不可用时，现有实现会保留已通过初步校验的词框。
- 内联合并最多访问 64 个节点、深度 4，要求子节点可以完整表示并包含目标节点与至少两个静态文本叶子。静态文本节点内部的换行替换为空格，独立 `AXLineBreak` 追加换行。
- 实现见 [macOS 原生查词](/Users/alan/projects/Dictol/native/accessibility/macos/src/accessibility.m) 和 [macOS 主进程适配器](/Users/alan/projects/Dictol/src/main/accessibility/platforms/macos.ts)。

## Windows UI Automation

```mermaid
flowchart TD
    A[Node 读取鼠标 DIP 坐标<br/>转换为物理屏幕坐标] --> B[工作线程创建 UI Automation<br/>ElementFromPoint 命中元素]
    B --> C[从命中元素沿 ControlView 父链<br/>最多检查 8 个元素的 TextPattern]
    C --> D{找到 TextPattern?}
    D -->|否| FAIL[返回失败或超时<br/>主进程回退 OCR]
    D -->|是| E[RangeFromPoint 获取光标位置的文本范围]
    E --> F[克隆范围并扩展到 TextUnit Word<br/>读取和修整词文本]
    F --> G{词有效?}
    G -->|空、对象占位符或无字母数字| FAIL
    G -->|有效| H[GetBoundingRectangles<br/>取得词范围的屏幕矩形]
    H --> I[若有多个矩形<br/>选取距离光标最近的矩形]
    I --> J{矩形有效且光标落在<br/>扩展 2 物理像素的矩形内?}
    J -->|否| FAIL
    J -->|是| K{includeContext?}
    K -->|false| OUT[返回 word 和物理屏幕词框]
    K -->|true| L[克隆光标范围<br/>扩展到 TextUnit Paragraph]
    L --> M[读取完整段落文本<br/>读取段首至词起点的文本]
    M --> N[将前缀和词范围前导空白换算成 UTF-16 长度<br/>作为词起点 offset]
    N --> O{段落中对应位置包含命中词?}
    O -->|否| FAIL
    O -->|是| P[返回 word、物理屏幕词框<br/>段落 text 和 offset]
    OUT --> Q[Node 将词框从物理坐标转回 DIP]
    P --> Q
    Q --> R{includeContext?}
    R -->|false| END[返回词和 DIP 词框]
    R -->|true| S[将 text 中对象占位符替换为空格<br/>按段落边界和 Intl.Segmenter 断句<br/>取当前句及段内最多各一句前后句]
    S --> T{断句成功且 context 不等于 word?}
    T -->|是| AI[返回词、词框、当前句和上下文]
    T -->|否| FAIL
```

- Windows 主进程对原生查词等待最多 1.2 秒。等待超时后可以进入 OCR，已启动的原生任务仍会继续执行。
- UI Automation 提供的段落范围取决于目标应用。原生 `offset` 指向去除前导空白后的词起点，Node 在这段文本内提取句子。
- 实现见 [Windows UI Automation](/Users/alan/projects/Dictol/native/accessibility/windows/src/ui_automation.rs) 和 [Windows 主进程适配器](/Users/alan/projects/Dictol/src/main/accessibility/platforms/windows.ts)。

两平台的断句和回退判断共用 [Accessibility 结果处理](/Users/alan/projects/Dictol/src/main/ocr/accessibility.ts) 和 [sentenceContextAt](/Users/alan/projects/Dictol/src/main/ocr/ocr-text.ts)。
