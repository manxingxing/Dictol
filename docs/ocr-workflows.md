## accessibility: 继续当前的方案，使用 rust/object-c - node 绑定
crate: windows 再经过nodejs绑定

mac
accessibility 原生层，修改行为为：
* 当 include_context: false(普通查词)时，：取得词和词框即可使用。不再返回未使用的 text, offset 字段
* 当 include_context: true(AI 语境查词)时，返回 text, offset。保留现在的上下文逻辑

**mac 已修改, win需要跟进**


> 当前逐词回退会把词的矩形向外扩展 2 个坐标单位做初次命中判断
考虑在精确命中失败后，在有限距离内寻找最近的词框，再验证候选位置


> 回退路径的 offset 语义不一致，且长文本直接放弃
相关位置：accessibility.m:159、accessibility.m:178-180

text.length > 8192 直接 nil；长段落（例如整段 9KB）在 Chrome 回退路径下完全不可用。
主路径 offset 是指针下的字符位置；逐词回退的 offset 是 NLTokenizer 的 token 起点。而且 word 可能从 offset 左侧开始（e-mail 命中 mail 时 word 从 0 开始，offset 是 2）。目前 offset 只用于找句子，影响有限，但契约不自洽，后续复用容易踩坑。


> 下一步建议围绕四个目标推进：避免不必要的 OCR、控制原生查询耗时、提高上下文完整性，以及让问题可复现。
1. 先完善诊断和测试基线。
   利用刚加的 Node.js 返回值日志和原生节点日志，记录几类真实场景：精确命中、光标略偏、行内样式变化、长文本和 Accessibility 失败。补充断句、UTF-16 偏移和节点合并的样例测试。当前节点日志会额外读取属性、影响耗时，因此性能测量需要与关闭日志时分开进行。
<!-- 2. 消除普通查词不必要的 OCR 回退。 -->
   <!-- 普通查词取得有效的词和词框后直接使用，不再以句子提取成功为前提；AI 解释仍需要检查上下文是否足够。这样可以避免断句问题影响本来已经成功的查词。 -->
3. 控制 Accessibility 查询耗时。
   在原生层设置查询时间预算，让多次 AX 调用之间可以提前结束，并处理已经失效的请求；主进程增加超时，及时进入 OCR 回退。同时检查本应用窗口查询被派发到主线程的路径，避免慢查询卡住界面。超时阈值需要根据实测确定。
4. 改进词定位和长文本支持。
   针对字符位置不可用时的逐词扫描，评估先按较大文本范围查矩形、再缩小候选范围的方案。验证跨行和矩形重叠后，再结合时间预算放宽当前 8192 个 UTF-16 代码单元的限制，避免长文本直接失败或查询过慢。
5. 改善光标接近文字时的命中率。
   精确命中失败后，可考虑在有限距离内选择最近的词框；需要用相邻行、多列等场景验证，防止取到错误的词，也要避免增加过多 AX 查询。
6. 明确上下文和换行语义。
   AI 模式继续支持跨样式节点收集文本，并研究从命中节点向两侧按需扩展。应先区分段内换行与段落边界，再决定何时跨行补充上下句；不能简单跳过未知节点或把所有换行替换为空格。断句留在主进程还是移到 macOS 原生层，也应通过样例比较效果和跨平台差异后决定。
7. 明确接口契约并整理诊断。
   在类型声明中说明 offset 的 UTF-16 单位和精度；如果将来需要精确的指针字符位置，再单独表达。将目前的详细日志整理成可控诊断，并更新过期的 [macos-ocr.md](/Users/alan/projects/Dictol/docs/macos-ocr.md)。
建议先做 1–3：它们能先提供判断依据、减少不必要回退，并限制慢查询的影响。之后根据真实样例和耗时数据，决定词定位、容错和上下文收集的具体方案。



### 测试集
中英文混杂返回的当前文本位置(不要出现整段被选中的情况)


## 截图
win
优先用 windows graphics API, 用 DXGI desktop Duplication API 回退
https://github.com/NiiightmareXD/windows-capture

Settings / GraphicsCaptureItem 里没有 source-rect / crop 参数，捕获的是整个 item（item.Size()）。自定义区域只能：捕获完整显示器/窗口 → 拿到 frame.buffer()（Frame / FrameBuffer）→ 在像素缓冲上自行裁剪。

这一点其实和你们 macOS 现状一致（macOS 旧路径也是"整屏/整窗 + crop"），也和 TS 层 cropOcrDisplay 的裁剪逻辑天然衔接。但意味着"光标附近小矩形"这个高频场景在 WGC 路径下仍要抓整屏再裁，效率不如当前 windows_screen_capture.rs 里用 D3D11_BOX 在 GPU 侧只拷贝子区域的做法。这是引入该 crate 需要权衡的一个性能点。

> DXGI Desktop Duplication 只能截显示器（整个 output），不能截窗口，也不能指定子区域（只能整屏 dup 后裁剪），且不绘制光标。所以它只能作为"截取显示器"的回退，覆盖不了"截取窗口"的回退——窗口捕获在 WGC 不可用时仍无 DXGI 兜底，得继续用 GDI BitBlt 或 Electron desktopCapturer。
> Desktop Duplication 对小块区域（OCR 场景）而言并不快（整屏 dup），对"截整屏"才是合适回退。
> 因此如果换成 windows-capture，对"光标附近小矩形"这种高频场景，反而会比现在 macOS / Windows 的"源端子区域抓取"多一次整屏拷贝，这是替换时要重点考量的性能回退，不是"和 macOS 现状一致"。
> crate 的 Frame::buffer_crop 会将指定子矩形复制到可供 CPU 读取的缓冲区。源码显示它先在 GPU 侧复制所需区域，再映射缓冲区；这与当前 Windows 实现中 [read_frame (line 763)](/Users/alan/projects/Dictol/native/ocr/windows/src/windows_screen_capture.rs:763) 的基本思路接近

GDI BitBlt 支持截取窗口吗？
"现在的 GPU 子区域拷贝"支持的windows版本如何？

1. 不再需要 gdi 回退
2. 引入 windows-capture crate
3. 实现与 macos 版本 screen-capture 一致的api
    * 截取整个显示器
    * 截取指定窗口
    * 截取指定区域
    * 返回窗口列表
    * 返回显示器列表
4. 截取指定区域沿用目前高效的 gpu 复制实现

> “与 macOS 一致”需要先统一 ID、坐标和返回字段的契约。
我记得node层有一层适配，这个具体的差异(id, 坐标, 字段, 坐标单位, 窗口信息，窗口列表范围)可以在这个适配层处理。我说的“与API一致”不代表两者完全相同，而是调用方式非常接近，简化node层的使用。在原生 rs 层，保持对应平台的语义即可

macos
支持 macOS 12.3+，但局部截图仅在 macos 14，在低版本上需要用 SCStreamConfiguration.sourceRect 或者截屏后裁切
https://crates.io/crates/screencapturekit


## 选区
1. 先逐个屏幕截图(不要使用promise.all并行)，以减少峰值内存占用
2. 逐个屏幕用截图内容绘制遮罩
3. 选区
4. 重点关注内存占用

实现 API
* 局部截图
* 截取整个屏幕(指定 display)
* 截取指定窗口
* 列出所有窗口?

## OCR
[@napi-rs/system-ocr](https://www.npmjs.com/package/@napi-rs/system-ocr)

快速路径会根据单个字符计算识别文本的边界矩形。而精确路径则按空格进行分词，这意味着在处理中文文本时，生成的边界框很可能只包含整行文本或其片段，而非完整的文本内容。
The fast path calculates the recognized text’s bounding rectangle based on its individual characters. The accurate path tokenizes on whitespace, which means when working with Chinese text, the resulting bounding boxes will likely contain lines or line fragments instead of complete text.


二）性能优化策略
图像预处理：

使用CIImage的CIAffineTransform调整图像方向，确保文字水平；
通过CIGaussianBlur（半径0.5~1.0）降低噪点，但需避免过度模糊导致文字失真；
对高分辨率图片（如4K相机输出），先通过CIImage的outputSize属性缩放至2000px以下以减少计算量。
异步处理与内存管理：

在后台线程执行OCR请求，避免阻塞主线程；
对连续识别场景（如视频流），复用VNImageRequestHandler实例以减少内存开销；
及时释放VNRecognizedTextObservation对象，避免内存累积。
结果后处理：

使用正则表达式过滤无效字符（如换行符、特殊符号）；
对多行文本进行语义拼接（如通过标点符号或关键词判断句子完整性）；
结合NLP模型（如CoreNLP）进行语义修正，提升复杂场景下的准确率。

* 确认 mac > 13 开启了自动语言识别

[ppu-paddle-ocr](https://www.npmjs.com/package/ppu-paddle-ocr#quick-start)

两个用途
1. 光标下的文本和上下文(悬停查词和语境查词)
    * 上下文需要拼接
2. 翻译选区内的文本：需要拼接
    不依赖ocr引擎返回的位置信息
3. 屏幕翻译
    依赖ocr引擎返回的框位置信息
4. 书籍翻译

## OCR 结果的文本拼接，段落重建
* 倾斜？
* 多栏
* 竖排
* 

> 宁可退化成简单排序，也不要把两栏错误合并
boxes → 去重 → 估字符高度 → 行聚类 → 横向分段 → 竖切分栏
      → 段内分段 → 脚本感知拼接 → blocks[]


## 测试集


