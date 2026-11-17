# RapidOCR 集成

Dictol 的「设置 → OCR」选择识别引擎，默认使用系统 OCR：macOS 使用 Apple Vision，Windows 使用 Windows.Media.Ocr；选择 PaddleOCR 时，通过 `rapidocr-node` 的 RapidOCR 管线运行 Paddle 的 ONNX 模型。设置同时影响悬停取词和截图翻译；悬停取词仍先尝试系统辅助功能，只有无法取得文本时才调用所选 OCR。切换引擎对后续请求生效，不会在失败时静默切换引擎。

## 模型与依赖

使用 `rapidocr-node` 0.2.3、ONNX Runtime 1.23.0 和 PP-OCRv6 small 中文检测和识别模型及方向分类模型。模型准备脚本 `npm run rapidocr:prepare` 使用上游提供的下载和校验方法，保存到 `resources/rapidocr`；该目录为构建产物，不提交到 Git。ONNX Runtime 固定为 1.23.0，因为 1.30.0 的 npm 包不包含 macOS x64 二进制文件。模型约 30 MB，实际安装包还包括 ONNX Runtime、OpenCV 和 sharp 等依赖。开发模式和 macOS、Windows 的打包脚本执行模型准备；运行时关闭模型自动下载。`rapidocr-node` 标注 Apache-2.0，ONNX Runtime 标注 MIT；ONNX Runtime 1.23.0 的许可正文和第三方声明随 `resources/rapidocr-licenses` 打包。RapidOCR 上游将已注册的 PP-OCR 模型标注为 Apache-2.0，但其[模型许可说明](https://rapidai.github.io/RapidOCRDocs/main/en/model_licenses/)明确不将识别字典纳入该声明；`multi_PP-OCRv6_rec_small-dictionary.txt` 与 [PaddleOCR 官方字典](https://github.com/PaddlePaddle/PaddleOCR/blob/main/ppocr/utils/dict/ppocrv6_dict.txt)的 SHA-256 均为 `b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d`；该比对确认内容一致，字典的适用条款仍需在发布前单独核对。

主进程按需启动 `rapid-ocr-worker`，Worker 中串行处理识别请求并复用模型，限制推理线程数；Worker 出错时拒绝待处理请求，后续请求可以重新创建 Worker。模型加载失败也会在后续请求中重试。识别管线保留行文本、置信度、四边形以及可用的词和字符框；归一化行框以左下为原点、四边形以左上为原点，字符范围使用 UTF-16 索引，符合现有文本命中接口。

Worker 将原图传给 RapidOCR，并通过 `usePreprocessImage: false` 关闭图像预缩放；检测器仍使用 RapidOCR 的默认尺寸设置。低置信度行使用检测框从原图裁剪后重试。

主进程日志以毫秒记录 PaddleOCR 截图耗时和来源；每次 Worker 请求记录往返耗时、队列等待、首次模型加载、图片元数据读取、RapidOCR 推理和结果转换耗时，以及原图和传入 RapidOCR 的尺寸。首次往返还包含 Worker 启动；推理耗时是 RapidOCR 整个 `recognize` 调用，并非单独的检测或识别模型耗时。低置信度重试逐次记录，并汇总重试耗时；识别总耗时包含排队、进程通信和重试，不包含截图及选区等待。日志不记录截图或识别文字。

## 管线和截图

`ocr.ts` 对悬停取词统一入口，分别调用 macOS、Windows 和 Paddle 管线；系统管线保留各自原生快照优化及重试。Paddle 的截图范围与 macOS Vision 一致：词典查词为 700 × 300 DIP，AI 查词为显示器全宽 × 600 DIP，靠近边缘时限制在显示器内；Paddle 使用自己的字符框命中。同一行拆成多个框时，根据框间距重建词间空格；一个词跨多个框时，高亮覆盖各碎片。截图翻译在 `screenshot-ocr.ts` 中分派引擎，Paddle 对低置信度行重新识别；系统识别可使用内置词典修复合并的英文词。共用的文本布局函数根据行框和栏间距重建阅读顺序：连续中日文及相邻标点不强加空格，英文和明显分隔的文字块保留空格。多栏识别依赖几何布局，表格或复杂排版仍需实测。

截图翻译使用透明遮罩选区，关闭遮罩后捕获所选区域并识别。选区期间屏幕内容可能发生变化。macOS 原生截图通过 ImageIO 从 CGImage 直接编码 PNG，macOS 13 的流式截图仍需转换帧数据。

## 开发和验证

- `npm run rapidocr:prepare`：下载并校验模型。
- `npm run typecheck`：检查主进程和 renderer 类型。
- `node --test src/main/controller/ocr-settings.test.cjs src/main/ocr/ocr-routing.test.cjs src/main/ocr/ocr-text-fragments.test.mjs`：验证配置、引擎分派和词语碎片命中。
- `node --test src/main/action/screenshot-translation.test.cjs src/main/ocr/ocr-translation.test.mjs`：验证选区后截图、引擎分派和多语言文本拼接。
- `npx electron-vite build`：验证 Worker 和各入口的构建。
- 模型准备并完成构建后运行 `node --test src/main/ocr/rapid-ocr-integration.test.mjs`，验证真实模型输出、字符框命中和翻译文本拼接；中英日合成样本依赖 macOS 系统字体，在其他平台跳过。
- `npx electron src/main/ocr/screenshot-ocr-smoke.cjs`：使用合成图片验证系统 OCR 和 PaddleOCR 的截图识别入口，不需要屏幕录制权限；Windows 系统 OCR 需要可用的识别语言。
- 在目标平台实际验证：macOS arm64/x64、Windows x64 安装包的模型与原生库加载；中英日、多栏、旋转文字和不同粒度的识别；截图选区、多显示器及不同缩放比例。

模型文件、ONNX Runtime 库和 sharp 原生依赖必须包含在对应目标架构的安装包中，且原生库需从 asar 解包。跨平台打包不能仅依靠开发机的识别成功证明目标系统可用。
