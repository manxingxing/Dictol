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
    C -->|否| E[Electron 截图后调用 Vision PNG OCR]
    D --> F[定位光标下文本、分词并映射词框]
    E --> F
    F --> G[返回词语和屏幕词框]
```

普通查词使用 `captureAndRecognizeMacText`，正常路径只传递显示器、坐标、语言和识别结果，不传 PNG 或图像句柄。未命中时直接返回。只有截图阶段失败才使用 Electron 降级，OCR 错误直接向上传递。

## Windows 悬停查词

```mermaid
flowchart TD
    A[进入 Windows OCR] --> B[截图鼠标附近 1000 × 300 DIP]
    B --> C[Windows 原生 OCR；截图失败时用 Electron 降级]
    C --> D{非英语识别器发现英文或需要重试?}
    D -->|是| E[同帧尝试 en-US]
    D -->|否| F{命中词语?}
    E --> F
    F -->|否| G[缩小到 550 × 290 DIP 重试]
    F -->|是| H[映射词框并返回]
    G --> H
```

## macOS AI 语境查词

```mermaid
flowchart TD
    A[进入 macOS OCR] --> B[截取鼠标附近显示器全宽 × 600 DIP 的区域 PNG]
    B --> C[裁出显示器宽度的 2/3 × 450 DIP；显示进度后识别]
    C --> D[定位词语、拼接邻近行并断句]
    D --> E{未命中或上下文不足且触及裁剪边缘?}
    E -->|是| F[直接识别已截取的整张区域 PNG]
    E -->|否| G[采用首次结果]
    F --> H[选取改善的结果并映射词框]
    G --> H
    H --> I[返回词语和上下文]
```

原生截图失败时使用 Electron 截图和 Vision PNG OCR；语言自动检测始终开启。

## Windows AI 语境查词

```mermaid
flowchart TD
    A[进入 Windows OCR] --> B[截取显示器；在光标附近 1024 × 500 DIP 内用 en-US 识别]
    B --> C{未命中?}
    C -->|是| D[从同一帧裁出 550 × 290 DIP 重试]
    C -->|否| E{上下文触及边缘或仍未命中?}
    D --> E
    E -->|是| F[从同一 PNG 裁出最多 1434 × 800 DIP]
    E -->|否| G[采用当前结果]
    F --> H[映射词框并返回]
    G --> H
```

## macOS 截图翻译

```mermaid
flowchart TD
    A[确认选区并关闭遮罩] --> B[等待窗口合成器移除遮罩]
    B --> C[原生区域截图返回 PNG；失败时 Electron 降级]
    C --> D[显示正在识别]
    D --> E[Vision 识别选区 PNG]
    E --> F[拼接文本；词典可用时修复英文黏连]
    F --> G[打开翻译窗口]
```

截图先于进度窗口，因此无需过滤提示窗。原生与降级路径均使用捕获好的 PNG，不保留原生图片句柄。

## Windows 截图翻译

```mermaid
flowchart TD
    A[确认选区并关闭遮罩] --> B[DIP 转物理坐标并截图；失败时 Electron 降级]
    B --> C[显示正在识别]
    C --> D[Windows OCR 识别选区 PNG]
    D --> E[拼接文本并按需修复英文黏连]
    E --> F[打开翻译窗口]
```

## 对照源码

- [悬停入口及 FORCE_OCR](../src/main/ocr/ocr.ts)、[Accessibility 结果处理](../src/main/ocr/accessibility.ts)。
- [macOS OCR](../src/main/ocr/mac-ocr.ts)、[Windows OCR](../src/main/ocr/win-ocr.ts)、[文本命中与上下文](../src/main/ocr/ocr-text.ts)。
- [截图翻译](../src/main/action/screenshot-translation.ts)、[识别与文本拼接](../src/main/ocr/screenshot-ocr.ts)、[截图适配](../src/main/ocr/screen-capture.ts)。
