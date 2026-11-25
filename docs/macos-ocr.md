# macOS 悬停取词、截图与 OCR

## 当前实现

- 悬停快捷键优先调用 macOS Accessibility API：获取鼠标下的字符范围、词语、屏幕矩形及同一段落内的相邻句子。浏览器正文等 `AXStaticText` 若不提供有效的光标字符范围，则逐词检查其 `AXBoundsForRange` 矩形。目标应用未提供可用的文本或范围矩形时，回退到 OCR。
- 辅助功能路径需要 macOS“辅助功能”授权；OCR 路径需要“屏幕录制”授权。两种路径返回相同的词语、句子上下文和屏幕矩形，继续使用现有查词、AI 解释和高亮弹窗。
- `native/ocr/macos` 使用 Objective-C 实现 ScreenCaptureKit 截图、Vision OCR 和 NaturalLanguage 分词，Objective-C++ 对接 Node-API。macOS 13 使用 SCStream 单帧捕获，14+ 使用 SCScreenshotManager，15.2+ 的区域截图使用全局矩形接口。
- `src/main/ocr/screen-capture.ts` 提供 PNG 截图；普通悬停查词使用 `captureAndRecognizeMacText` 一次性截图并识别。AI 语境查词使用 `captureMacOcrImage` 保留原生图像句柄。原生截图失败时直接报告错误，不使用 Electron 截图回退。
- 截图翻译先取得选区 PNG，再显示“正在识别”，最后调用平台 OCR。提示窗在截图后出现，无需窗口过滤或隐藏／恢复逻辑。
- 普通查词传入显示器 ID 和鼠标附近 1000×300 DIP 区域，在同一原生任务中截图并使用 Vision `accurate` 识别。正常路径不编码 PNG，只返回 OCR 结果和像素尺寸；未命中时直接返回。
- AI 解释先在原生保留鼠标附近“显示器全宽×600 DIP”的图像，截图后显示进度；Node 指定“显示器宽度的 2/3×450 DIP”区域，原生使用 `CGImageCreateWithImageInRect` 裁剪并识别，只返回识别结果。未命中或上下文不足且触及裁剪边缘时，通过同一句柄识别完整图像。查词结束在 `finally` 中调用 `dispose()`，Node-API finalizer 兜底；每个异步任务独立持有图像引用。
- `native/ocr/macos/src/ocr.m` 返回行文本、置信度、行矩形，以及每个 Unicode 字符对应的 Vision 文本范围矩形。Vision `accurate` 对拉丁字母通常返回词级矩形，对中文通常可返回字符级矩形。
- `src/main/ocr/ocr-text.ts` 用 Vision 矩形定位鼠标下的字并计算高亮词框；只有后端缺少字符矩形时才使用字符宽度估算。坐标先保持为图片内归一化值，最后映射回屏幕 DIP。

识别语言为英语、中文（简体与繁体）、日语、法语、韩语和德语，由 `src/main/ocr/mac-ocr-languages.ts` 统一定义，普通查词、语境查词和截图翻译共用。Vision 开启自动语言检测与语言修正。

## 强制使用 OCR 调试

```sh
FORCE_OCR=1 npm run dev
# 或启用主进程调试端口
FORCE_OCR=1 npm run inspect
```

设置 `FORCE_OCR` 后，普通悬停查词和 AI 语境查词均跳过 Accessibility，直接使用 Apple Vision OCR。只要变量存在即启用；取消设置（`unset FORCE_OCR`）后恢复辅助功能优先。该开关不影响截图翻译。

## 记录一次本地诊断

在终端启动开发应用前设置变量：

```sh
DICTOL_OCR_DIAGNOSTICS=1 npm run dev
```

然后在目标文字上按悬停取词快捷键。主进程会打印 `[HoverText] macOS Accessibility` 的命中状态及失败阶段，不记录屏幕文字；仅当辅助功能未命中而进入 OCR 时，才会在应用的 `userData/ocr-diagnostics` 目录保存三份同名文件：

- PNG：实际送入 Vision 的截图。
- SVG：截图、蓝色行框、紫色 Vision 文本范围框、黄色选中词框和红色鼠标点。
- JSON：截图 DIP 区域、像素尺寸、鼠标坐标、Vision 文本与置信度、最终取词结果。

这些文件可能包含屏幕上的私人文字；只有显式设置环境变量才会保存。打开 SVG 可直接区分截图坐标问题、Vision 识别错误和取词定位错误。

对同一帧比较语言配置：

```sh
node scripts/compare-macos-ocr.mjs /path/to/ocr-diagnostics/example.json
```

脚本会依次尝试当前四语言、简体中文、日语和英语的 `accurate` 识别，输出鼠标所在行、置信度和耗时。比较时使用同一 PNG，避免其他软件界面变化影响结果。

## 参考

- [Accessibility 文本位置与范围属性](https://developer.apple.com/documentation/applicationservices/carbon_accessibility/parameterized_attributes)
- [Vision 文本识别请求](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)
- [Vision 文本范围矩形](https://developer.apple.com/documentation/vision/vnrecognizedtext/boundingbox(for:))
- [ScreenCaptureKit 区域截图](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager/captureimage(in:completionhandler:))
