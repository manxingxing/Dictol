# 悬停查词、AI 语境查词与截图翻译流程

macOS 使用 Apple Vision，Windows 使用 Windows.Media.Ocr。OCR 引擎按平台固定，不提供引擎配置页。

## 悬停入口与 FORCE_OCR

普通查词和 AI 查词共用 `src/main/ocr/ocr.ts`。未设置 `FORCE_OCR` 时先尝试系统辅助功能；已确认光标位于空白时直接返回，无法取得可靠文本或调用失败时才进入 OCR。设置 `FORCE_OCR` 后完全跳过辅助功能。

```mermaid
flowchart TD
    A[悬停查词或 AI 查词] --> B{设置了 FORCE_OCR?}
    B -->|是| F[进入对应平台 OCR]
    B -->|否| C[Accessibility / UI Automation]
    C --> D{获取结果}
    D -->|词语及所需上下文有效| E[展示词典或 AI 解释]
    D -->|确认光标处无词| G[返回未命中]
    D -->|无法获取或异常| F
```

使用 `FORCE_OCR=1 npm run dev` 或 `FORCE_OCR=1 npm run inspect` 调试。只要环境变量存在即启用，包括空字符串；取消设置后恢复辅助功能优先。该开关不改变截图翻译路径。

## macOS 悬停查词

```mermaid
flowchart TD
    A[进入 macOS OCR] --> B[截图鼠标附近 1000 × 300 DIP]
    B --> C{原生截图成功?}
    C -->|是| D[同一原生任务用 CGImage 调用 Vision accurate]
    C -->|否| E[直接报告截图错误]
    D --> F[定位光标下文本、分词并映射词框]
    F --> G[返回词语和屏幕词框]
```

普通查词使用 `captureAndRecognizeMacText`，正常路径只传递显示器、坐标、语言和识别结果，不传 PNG 或图像句柄。未命中时直接返回。截图与 OCR 错误直接向上传递，不使用 Electron 截图回退。

## Windows 悬停查词

```mermaid
flowchart TD
    A[进入 Windows OCR] --> B[截图鼠标附近 1000 × 300 DIP]
    B --> C[按配置选择 GDI 或单次 WGC 截图，再将 BGRA 交给 OCR]
    C --> F{命中词语?}
    F -->|否| G[缩小到 550 × 290 DIP 重试]
    F -->|是| H[映射词框并返回]
    G --> H
```

普通查词使用 `captureAndRecognizeWindowsText`，不编码 PNG，也不在 Node 层传递像素或图像引用。原生识别后释放图像，只返回识别结果。未命中时以 550 × 290 DIP 重新截图并使用相同语言识别。总耗时日志包含所有区域重试。

Windows 设置页的 OCR 入口可选择跟随系统、中文（简体）、英语、日语、韩语、法语或德语。悬停查词、AI 语境查词和截图翻译在每次操作开始时读取配置，所有区域识别均使用该语言，不自动切换语言重试。缺少对应 OCR 语言包时报告识别错误。macOS 不显示该设置入口，也不读取或应用该配置。

Windows OCR 设置提供“截屏方案”，可选 GDI、WGC，默认 GDI。悬停查词、AI 语境查词和截图翻译每次操作开始时读取配置，将 engine 逐层传到原生截图实现；区域、显示器和窗口截图均支持指定方案。GDI 与 WGC 不相互回退，失败直接报告错误，也不使用 Electron 截图回退。WGC 每次创建单次会话，取一帧后停止，不维持或复用会话，要求 Windows 10 1903（18362）或以上。普通悬停查词直接使用 BGRA 图像，AI 语境查词使用原生图像句柄，两者均不经过 PNG；截图翻译保留 PNG 接口。macOS 不读取或使用此配置。

## macOS AI 语境查词

```mermaid
flowchart TD
    A[进入 macOS OCR] --> B[原生保留显示器全宽 × 600 DIP 图像并返回句柄]
    B --> C[显示进度；原生裁剪宽度的 2/3 × 450 DIP 并识别]
    C --> D[定位词语、拼接邻近行并断句]
    D --> E{未命中或上下文不足且触及裁剪边缘?}
    E -->|是| F[通过同一句柄识别完整图像]
    E -->|否| G[采用首次结果]
    F --> H[选取改善的结果并映射词框]
    G --> H
    H --> I[返回词语和上下文；finally 释放句柄]
```

两平台的 AI 路径共用截图带尺寸、扩大识别条件和结果选择规则。原生保留截图并返回句柄和像素尺寸，Node 显示进度后指定小区域，由原生直接裁剪并识别；需要扩大识别时通过同一句柄识别完整图像。每次查词均在 `finally` 中显式释放，原生析构兜底；异步任务持有独立引用，允许任务执行期间释放句柄。macOS 原生截图失败时直接报告错误，不使用 Electron 截图回退；语言自动检测始终开启。

## Windows AI 语境查词

```mermaid
flowchart TD
    A[进入 Windows OCR] --> B[原生保留显示器全宽 × 600 DIP 图像并返回句柄]
    B --> C[显示进度；原生裁剪宽度的 2/3 × 450 DIP 并用配置语言识别]
    C --> D[定位词语、拼接邻近行并断句]
    D --> E{未命中或上下文不足且触及裁剪边缘?}
    E -->|是| F[通过同一句柄识别完整图像；最多重试一次]
    E -->|否| G[采用首次结果]
    F --> H[选取改善的结果并映射词框]
    G --> H
```

Windows 普通词典悬停仍保留独立的原生截图/OCR 路径及未命中时的窄区域重试；AI 路径不再执行 550 × 290 DIP 的窄区域或 1434 × 800 DIP 的扩大区域识别。

AI 路径用 `finally` 释放句柄；GDI 与 WGC 截图后的像素统一由 `Arc<RawFrame>` 管理，不保留截图会话。

## macOS 截图翻译

```mermaid
flowchart TD
    A[确认选区并关闭遮罩] --> B[等待窗口合成器移除遮罩]
    B --> C[原生区域截图返回 PNG；失败时直接报告错误]
    C --> D[显示正在识别]
    D --> E[Vision 识别选区 PNG]
    E --> F[拼接文本；词典可用时修复英文黏连]
    F --> G[打开翻译窗口]
```

截图先于进度窗口，因此无需过滤提示窗。截图翻译使用原生捕获的 PNG，不保留原生图片句柄。

## Windows 截图翻译

```mermaid
flowchart TD
    A[确认选区并关闭遮罩] --> B[DIP 转物理坐标；按配置选择 GDI 或单次 WGC]
    B --> C[显示正在识别]
    C --> D[Windows OCR 识别选区 PNG]
    D --> E[拼接文本并按需修复英文黏连]
    E --> F[打开翻译窗口]
```

## 对照源码

- [悬停入口及 FORCE_OCR](../src/main/ocr/ocr.ts)、[Accessibility 结果处理](../src/main/ocr/accessibility.ts)。
- [macOS OCR](../src/main/ocr/mac-ocr.ts)、[Windows OCR](../src/main/ocr/win-ocr.ts)、[文本命中与上下文](../src/main/ocr/ocr-text.ts)。
- [截图翻译](../src/main/action/screenshot-translation.ts)、[识别与文本拼接](../src/main/ocr/screenshot-ocr.ts)、[截图适配](../src/main/ocr/screen-capture.ts)。
