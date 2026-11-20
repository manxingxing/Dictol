# macOS OCR 长等待调查（2026-11-20）

## 结论与范围

本次进程 `93631` 的 OCR 长等待对应 Apple Neural Engine 的模型编译。
Vision 的同步 `performRequests` 等待模型准备完成；后续请求也等待同一准备过程。
编译完成后，三个请求相继完成，Node 的完成回调及 Promise 交付没有明显延迟。

独立 Objective-C 程序复用了生产 `ocr.m`，在不加载 Node、Electron、不截图的情况下复现了首次约 20 秒、第二次约 50 毫秒的差异，并采集到模型编译栈。
因此本次长等待的成因已经有系统日志、独立复现及线程采样三组证据。

**本轮没有修改生产 OCR 实现。** 新增的原生诊断程序只使用合成文字，不保存或读取真实屏幕。

## 故障时间线

环境：macOS 27.2.1（26B131）。以下时间为 Asia/Shanghai，精度来自系统统一日志与应用日志。

| 时间 | 事件 |
| --- | --- |
| 08:23:18.408 | Electron 93631 的 TextRecognition 收到 1400×600 图像 |
| 08:23:20.243 | ANECompilerService 开始编译网络 |
| 08:23:53.871 | ANE 网络编译结束，耗时约 33.63 秒 |
| 08:23:54.486 | 编译服务返回 `ret(0)` |
| 08:23:54.814 | 编译服务报告 `SUCCESS` |
| 08:23:54.904 | 第一个 Vision 请求完成，耗时 36509.07 毫秒 |
| 08:23:54.981 | 第二个 Vision 请求完成，耗时 31010.67 毫秒 |
| 08:23:55.046 | 第三个 Vision 请求完成，耗时 16185.52 毫秒 |

首次请求在编译成功约 90 毫秒后完成。三个请求的不同耗时对应不同进入时间，而完成时间集中在编译完成后。
结合独立复现，可以解释为请求等待模型编译完成，不能把这些耗时当作稳定状态下的文字识别成本。

用于核对的系统日志消息（保留系统自身的隐私隐藏）：

```text
2026-11-20 08:23:20.243 ANECompilerService: Start of compilation of network from file: <private>
2026-11-20 08:23:53.871 ANECompilerService: End of compilation of network from file: <private>
2026-11-20 08:23:54.486 ANECompilerService: Calling ANE compiler done ret(0)
2026-11-20 08:23:54.814 ANECompilerService: SUCCESS: model=<private> ... lErr=(nil)
```

原始筛选日志位于本机临时目录，未复制完整系统日志到仓库：

- `/tmp/dictol-ocr-coreml-93631.log`：故障进程及 ANE 服务日志。
- `/tmp/dictol-ocr-client-93631.log`：故障进程的 TextRecognition、Espresso、ANE 日志。
- `/tmp/dictol-ocr-cold-start.sample.txt`：独立复现时的线程采样。
- `/tmp/dictol-ocr-cold-start.log`：独立程序首次与第二次调用结果。

## 控制变量实验

诊断程序为 `tests/native/ocr/macos-ocr-cold-start.m`，直接调用生产 `recognize_image`。
配置保持 `accurate`、自动语言检测、语言修正，以及 `zh-Hans,en-US,ja-JP,zh-Hant`。
每个进程对同一张 1400×600 合成图连续识别两次。

| 实验 | 第一次 Vision 调用 | 第二次 Vision 调用 |
| --- | ---: | ---: |
| 新诊断程序，签名标识 `com.dictol.ocr.cold-start.probe` | 20360.83 ms | 50.81 ms |
| 保持文件、路径、签名不变，重新启动进程 | 164.75 ms | 51.48 ms |
| 仅将签名标识改为 `com.dictol.ocr.cold-start.probe.revision2` | 20437.59 ms | 57.69 ms |

实验没有清理系统缓存、关闭硬件加速或修改识别参数。
签名实验只操作 `/tmp` 下的诊断程序，没有修改 Electron 或任何发布产物的签名。

这证明在当前环境中，编译结果可跨进程复用，而改变可执行程序的签名身份足以使首次识别重新付出模型编译成本。
它不证明普通 JS 文件修改本身会使 Vision 缓存失效，也没有定位生产应用这次具体是哪项构建产物或系统缓存条件发生了变化。

## 阻塞期间的线程证据

诊断进程 94406 在首次识别超过 3 秒时被采样。调用线程停留在：

```text
main
  recognize_image
    VNImageRequestHandler performRequests
      VNRecognizeTextRequest internalPerformRevision
        VNCRImageReaderDetector
          TextRecognition
            _dispatch_semaphore_wait_slow
              semaphore_wait_trap
```

同时工作线程正在执行：

```text
e5rt_e5_compiler_compile
  E5RT::E5CompilerImpl::Compile
    E5RT::E5CompilerImpl::CompileInternal
      E5RT::OnDeviceAOTCompilerInterface::Compile
        Espresso::AOT::E5AOTCompilerBackend::Run
          Espresso::AOT::MILCompilerForE5::Run
            Espresso::AOT::Validators::AneValidator::Validate
```

该进程最终正常返回，无需重启或中断；没有使用超时恢复来让实验成功。

## 复现命令

在仓库根目录编译独立诊断程序：

```sh
clang -fobjc-arc -fblocks -O2 -mmacosx-version-min=13.0 \
  -Inative/ocr/macos/src \
  tests/native/ocr/macos-ocr-cold-start.m native/ocr/macos/src/ocr.m \
  -framework Foundation -framework CoreGraphics -framework CoreText \
  -framework Vision -framework ImageIO \
  -o /tmp/dictol-ocr-cold-start
codesign --force --sign - --identifier com.dictol.ocr.cold-start.probe \
  /tmp/dictol-ocr-cold-start
/tmp/dictol-ocr-cold-start
/tmp/dictol-ocr-cold-start
```

需要测试新身份时，只对临时诊断程序使用新的标识；首次是否触发编译及耗时以当前机器的日志为准。
不要删除系统模型缓存来强制复现。

阻塞时可从另一个终端采集诊断程序输出的 PID：

```sh
sample <PID> 2 -file /tmp/dictol-ocr-cold-start.sample.txt
```

## 对实现的含义

- 调整 PNG 传输、原生调用入口或 JS Promise 不能省去模型首次编译成本。
- 串行化请求只能减少同时等待的任务，不能消除第一次编译耗时；本次单请求原生程序也出现长等待。
- 预热能提前承担成本，但仍会发生编译，也不能保证缓存以后不会被系统清理。
- 若改善体验，应明确展示首次准备状态并避免重复发起已过时的查词任务。此类行为修改需单独确定范围，本次没有实施。

## 仍未验证

- 上一次故障没有按同样方式关联完整时间线，不能仅凭相似症状认定它与本次完全相同。
- 未定位生产应用具体哪项构建变化导致本次编译；系统日志中的模型标识及路径被隐藏。
- 未在 macOS 13/14、Intel 或安装版稳定签名环境复现；不能将当前机器的编译时长推广到所有环境。

Apple 的 [Core ML 模型性能说明](https://developer.apple.com/documentation/coreml/analyzing-a-core-ml-model-s-performance-in-xcode)
区分了缓存与未缓存加载，以及设备特化成本；[WWDC23 的 Core ML 集成说明](https://developer.apple.com/videos/play/wwdc2023/10049/)
解释了计算设备专用编译、磁盘缓存及跨启动复用。这些文档支持机制解释；本次故障归因主要依据本机时间线和控制变量实验。
