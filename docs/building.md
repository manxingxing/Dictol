# 分步打包

macOS / Windows 安装包可以分成 native 依赖和 Electron 两步构建。Node 版本使用 `.nvmrc`：

```bash
nvm use

# 只在 native 代码或目标平台二进制需要更新时运行对应命令
npm run build:native:mac:x64
npm run build:native:mac:arm64
npm run build:native:win:x64

# 使用已准备好的 native 依赖构建 Electron 安装包
npm run build:electron -- --platform mac --arch x64
npm run build:electron -- --platform mac --arch arm64
npm run build:electron -- --platform win --arch x64
```

Electron 阶段不会重新编译 `.node` 文件。macOS 系统翻译 helper 会由 native 阶段按架构生成到 `native/system-translation/prebuilds/`，Electron 阶段选择目标版本并暂存到 `resources/system-translation/` 后打包。上游提供的 SQLite `simple` 扩展按平台/架构保存在 `native/sqlite-simple/prebuilds/`，Electron 会将其作为额外资源复制到应用的 `sqlite-simple/` 目录。electron-builder 配置会按目标平台筛选 native 模块、SQLite 扩展和系统辅助程序；`afterPack` 会检查最终安装包中的架构及必需导出。Windows native 构建与安装包签名需要本机配置 `WIN_CSC_PASSWORD` 和 `build/codesign.pfx`（或通过 `WIN_CSC_FILE` 指定证书）。
