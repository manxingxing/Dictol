# macOS 悬停取词、截图与 OCR

## 当前实现

- 悬停快捷键优先调用 macOS Accessibility API：获取鼠标下的字符范围、词语、屏幕矩形及同一段落内的相邻句子。浏览器正文等 `AXStaticText` 若不提供有效的光标字符范围，则逐词检查其 `AXBoundsForRange` 矩形。目标应用未提供可用的文本或范围矩形时，回退到 OCR。
- 辅助功能路径需要 macOS“辅助功能”授权；OCR 路径需要“屏幕录制”授权。两种路径返回相同的词语、句子上下文和屏幕矩形，继续使用现有查词、AI 解释和高亮弹窗。
- `src/main/screen-capture.ts` 使用 ScreenCaptureKit 截图，返回 PNG、像素尺寸与 Electron DIP 区域；系统不支持时回退到 Electron 截图。
- 普通查词直接截取鼠标附近 850×320 DIP，使用 Vision `accurate` 识别。
- AI 解释先截取当前显示器，再从同一帧裁出 1024×500 DIP 使用 Vision `fast` 识别；未命中或悬停行置信度低于 0.4 时，对同一裁剪图执行 `accurate` 回退；上下文触及边缘时复用原帧扩大范围。
- `native/mdict-node/src/macos_ocr.m` 返回行文本、置信度、行矩形，以及每个 Unicode 字符对应的 Vision 文本范围矩形。Vision `accurate` 对拉丁字母通常返回词级矩形，对中文通常可返回字符级矩形。
- `src/main/ocr-text.ts` 用 Vision 矩形定位鼠标下的字并计算高亮词框；只有后端缺少字符矩形时才使用字符宽度估算。坐标先保持为图片内归一化值，最后映射回屏幕 DIP。

识别语言为日语、简体中文、英语、繁体中文，Vision 开启自动语言检测与语言修正。固定样例对比发现，原先英语优先且未开启自动检测时，中文行可能被识别成字母；当前组合在合成中英日混排图及仓库中英混排截图上表现较好。真实应用中的字体、缩放和背景仍需继续验证。

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
