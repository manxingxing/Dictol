# 悬停查词、AI 语境查词与截图翻译流程

本文依据当前源码绘制。每张图对应一个功能和操作系统，展示已实现的分支。系统 OCR 与 PaddleOCR 都有各自的悬停入口，目前部分后处理仍共用 `selectOcrTextHit()`。

## macOS 悬停查词

```mermaid
flowchart TD
    A[触发悬停查词快捷键<br/>记录锚点、隐藏旧高亮] --> B[读取鼠标屏幕坐标]
    B --> C[macOS Accessibility<br/>includeContext = false]
    C --> C1[命中测试和必要的 20 ms 重试<br/>字符位置、分词、词框校验<br/>必要时搜索子节点和祖先]
    C1 --> D{得到词和词框?}
    D -->|是| Z[显示词典解释并高亮词框]
    D -->|否或异常| E{选择的 OCR 引擎}
    E -->|系统| F[截取鼠标周围 700 × 300 DIP<br/>原生截图并调用 Vision accurate]
    F --> G{原生截图失败?}
    G -->|是| H[Electron 截图回退<br/>PNG 交给 Vision]
    G -->|否| I[识别行、文本范围和矩形]
    H --> I
    E -->|PaddleOCR| P[截取鼠标周围 700 × 300 DIP<br/>ScreenCaptureKit 或 Electron 回退]
    P --> Q[RapidOCR Worker 识别<br/>转换为行和文本范围矩形]
    I --> R[按光标选中或寻找附近文本行<br/>利用范围矩形定位字符]
    Q --> R
    R --> S[拼接邻近文本、分词和断句<br/>推导词框并映射到屏幕坐标]
    S --> T{命中词?}
    T -->|是| Z
    T -->|否或异常| U[显示识别失败]
```

## Windows 悬停查词

```mermaid
flowchart TD
    A[触发悬停查词快捷键<br/>记录锚点、隐藏旧高亮] --> B[读取鼠标 DIP 坐标<br/>转换为物理屏幕坐标]
    B --> C[Windows UI Automation<br/>includeContext = false]
    C --> C1[元素命中、查找 TextPattern<br/>RangeFromPoint 扩展到词<br/>验证词框并转回 DIP]
    C1 --> D{得到词和词框?<br/>等待上限 1.2 秒}
    D -->|是| Z[显示词典解释并高亮词框]
    D -->|否、超时或异常| E{选择的 OCR 引擎}
    E -->|系统| F[截取鼠标周围 850 × 320 DIP<br/>Windows 原生截图和系统 OCR]
    F --> G{原生截图失败?}
    G -->|是| H[Electron 截图回退<br/>PNG 交给 Windows OCR]
    G -->|否| I[使用系统首选语言识别并定位]
    H --> I
    I --> J{非英语识别器且发现英文<br/>或符合重试条件?}
    J -->|是| K[尝试用 en-US 重新识别<br/>可用时采用英文命中]
    J -->|否| L{命中词?}
    K --> L
    L -->|否| M[缩小到 550 × 290 DIP 重试<br/>改善倾斜文字识别]
    L -->|是| N[选中结果]
    M --> N
    E -->|PaddleOCR| P[截取鼠标周围 700 × 300 DIP<br/>Windows 截图或 Electron 回退]
    P --> Q[RapidOCR Worker 识别<br/>转换为行和文本范围矩形]
    Q --> R[定位光标下文本、拼接邻近行<br/>分词、断句并推导词框]
    N --> R
    R --> S{命中词?}
    S -->|是| T[词框映射到 DIP<br/>倾斜文本使用四边形]
    T --> Z
    S -->|否或异常| U[显示识别失败]
```

## macOS AI 语境查词

```mermaid
flowchart TD
    A[触发 AI 语境查词快捷键<br/>记录锚点并预热解释窗口] --> B[读取鼠标屏幕坐标]
    B --> C[macOS Accessibility<br/>includeContext = true]
    C --> D[定位词和词框<br/>读取文本及 UTF-16 offset<br/>尝试合并相邻内联文本]
    D --> E{有 text 和 offset<br/>且断句得到的上下文不等于词?}
    E -->|是| Z[提交词、当前句和上下文<br/>显示 AI 解释并高亮词框]
    E -->|否或异常| F{选择的 OCR 引擎}
    F -->|系统| G[截图为显示器宽 × 600 DIP<br/>在约显示器宽的三分之二 × 450 DIP 内<br/>使用 Vision accurate 识别]
    G --> H{原生截图失败?}
    H -->|是| I[Electron 截图回退<br/>PNG 交给 Vision]
    H -->|否| J[用识别结果定位光标下的行和词<br/>拼接邻近行并断句]
    I --> J
    J --> K{未命中，或上下文不完整且触及裁剪边缘?}
    K -->|是| L[复用同一截图扩大识别区域<br/>选取命中、上下文更好或置信度更高的结果]
    K -->|否| M[采用首次结果]
    L --> N[映射词框至屏幕坐标]
    M --> N
    F -->|PaddleOCR| P[截取显示器宽 × 600 DIP<br/>ScreenCaptureKit 或 Electron 回退]
    P --> Q[RapidOCR Worker 识别<br/>对低置信度行尝试重新识别]
    Q --> R[定位光标下的行和词<br/>拼接邻近行、断句并映射词框]
    N --> S{得到词和上下文?}
    R --> S
    S -->|是| Z
    S -->|否或异常| U[显示识别失败]
```

## Windows AI 语境查词

```mermaid
flowchart TD
    A[触发 AI 语境查词快捷键<br/>记录锚点并预热解释窗口] --> B[读取鼠标 DIP 坐标<br/>转换为物理屏幕坐标]
    B --> C[Windows UI Automation<br/>includeContext = true]
    C --> D[定位词和词框<br/>获取所在段落及 UTF-16 offset<br/>词框转回 DIP]
    D --> E{1.2 秒内得到结果<br/>且断句上下文不等于词?}
    E -->|是| Z[提交词、当前句和上下文<br/>显示 AI 解释并高亮词框]
    E -->|否、超时或异常| F{选择的 OCR 引擎}
    F -->|系统| G[截取整个显示器<br/>在光标附近 1024 × 500 DIP 内<br/>使用 en-US Windows OCR]
    G --> H{原生截图失败?}
    H -->|是| I[Electron 截图回退<br/>PNG 交给 Windows OCR]
    H -->|否| J[定位光标下的行和词<br/>拼接邻近行并断句]
    I --> J
    J --> K{未命中?}
    K -->|是| L[从同一截图裁剪 550 × 290 DIP 重试<br/>改善倾斜文字识别]
    K -->|否| M{未命中或上下文触及裁剪边缘?}
    L --> M
    M -->|是| N[复用截图扩大到最多 1434 × 800 DIP<br/>采用改善的结果]
    M -->|否| O[采用当前结果]
    N --> R[词框映射到 DIP<br/>倾斜文本使用四边形]
    O --> R
    F -->|PaddleOCR| P[截取显示器宽 × 600 DIP<br/>Windows 截图或 Electron 回退]
    P --> Q[RapidOCR Worker 识别<br/>对低置信度行尝试重新识别]
    Q --> V[定位光标下的行和词<br/>拼接邻近行、断句并映射词框]
    R --> S{得到词和上下文?}
    V --> S
    S -->|是| Z
    S -->|否或异常| U[显示识别失败]
```

## macOS 截图翻译

```mermaid
flowchart TD
    A[触发截图翻译<br/>显示各显示器选区遮罩] --> B[用户选择区域<br/>校验区域并关闭遮罩]
    B --> C[等待 80 ms 让遮罩消失]
    C --> D[使用 ScreenCaptureKit 截图]
    D --> E{原生截图成功?}
    E -->|否| F[使用 Electron 截图回退]
    E -->|是| G[得到选区 PNG]
    F --> G
    G --> H[显示识别进度]
    H --> I{选择的 OCR 引擎}
    I -->|系统| J[Vision accurate 识别 PNG]
    I -->|PaddleOCR| K[RapidOCR Worker 识别 PNG<br/>对低置信度行尝试重新识别]
    J --> L[过滤空行、按位置排序<br/>检测分栏、拼接行和段落]
    K --> L
    L --> M{系统 OCR 且词典可用?}
    M -->|是| N[尝试修复英文黏连词]
    M -->|否| O[使用拼接文本]
    N --> P{截断后有文本?}
    O --> P
    P -->|是| Q[打开翻译窗口<br/>按配置的翻译服务翻译]
    P -->|否或异常| R[显示识别失败]
```

## Windows 截图翻译

```mermaid
flowchart TD
    A[触发截图翻译<br/>显示各显示器选区遮罩] --> B[用户选择区域<br/>校验区域并关闭遮罩]
    B --> C[等待 80 ms 让遮罩消失]
    C --> D[选区从 DIP 映射到物理屏幕坐标<br/>使用 Windows Graphics Capture 截图]
    D --> E{原生截图成功?}
    E -->|否| F[使用 Electron 截图回退]
    E -->|是| G[得到选区 PNG]
    F --> G
    G --> H[显示识别进度]
    H --> I{选择的 OCR 引擎}
    I -->|系统| J[Windows OCR 使用系统首选语言识别 PNG]
    I -->|PaddleOCR| K[RapidOCR Worker 识别 PNG<br/>对低置信度行尝试重新识别]
    J --> L[过滤空行、按位置排序<br/>检测分栏、拼接行和段落]
    K --> L
    L --> M{系统 OCR 且词典可用?}
    M -->|是| N[尝试修复英文黏连词]
    M -->|否| O[使用拼接文本]
    N --> P{截断后有文本?}
    O --> P
    P -->|是| Q[打开翻译窗口<br/>按配置的翻译服务翻译]
    P -->|否或异常| R[显示识别失败]
```

## 对照源码

- 入口与 Accessibility 回退：[悬停路由](../src/main/ocr/ocr.ts)、[Accessibility 结果处理](../src/main/ocr/accessibility.ts)、[悬停弹窗](../src/main/controller/selection-toolbar.ts)。
- 悬停 OCR：[macOS 系统 OCR](../src/main/ocr/mac-ocr.ts)、[Windows 系统 OCR](../src/main/ocr/win-ocr.ts)、[PaddleOCR](../src/main/ocr/paddle-ocr.ts)、[共享词定位与上下文处理](../src/main/ocr/ocr-text.ts)。
- 截图翻译：[选区与窗口](../src/main/action/screenshot-translation.ts)、[引擎调用](../src/main/ocr/screenshot-ocr.ts)、[文本组装](../src/main/ocr/ocr-translation.ts)、[截图适配](../src/main/ocr/screen-capture.ts)。

系统 OCR 与 PaddleOCR 的截图、识别、重试策略分别实现，当前悬停取词仍共用部分命中、分词、上下文和词框处理。截图翻译共享行和段落组装，系统 OCR 在词典可用时额外执行英文黏连修复。
