# 可配置的跨软件划词取词方案

## 目标

在现有快捷键取词之外，增加可开关的实时划词取词：

- 自动划词关闭：只在用户按下全局快捷键时查询当前选区。
- 自动划词开启：用户在其他应用中选中文字后自动查词。
- 快捷键始终保留，不与自动划词互斥。
- 设置持久化，应用重启后恢复。

底层统一使用 [`selection-hook`](https://github.com/0xfullex/selection-hook)。不再维护自定义的原生取词实现。

## selection-hook 模式对应关系

| Dictol 模式  | selection-hook 配置           | 获取文本方式                       |
| ------------ | ----------------------------- | ---------------------------------- |
| 仅快捷键取词 | `selectionPassiveMode: true`  | 快捷键触发 `getCurrentSelection()` |
| 自动划词取词 | `selectionPassiveMode: false` | 监听 `text-selection` 事件         |

运行期间可以调用 `setSelectionPassiveMode()` 切换，不需要销毁并重新创建 `SelectionHook`。

## 状态模型

扩展现有设置：

```ts
type WordCaptureSettings = {
  shortcut: string
  automaticLookupEnabled: boolean
}
```

扩展返回给 Renderer 的状态：

```ts
type WordCaptureStatus = {
  supported: boolean
  trusted: boolean
  registered: boolean
  shortcut: string
  automaticLookupEnabled: boolean
}
```

继续存储在：

```text
app.userData/word-capture.json
```

读取旧版本配置时，缺失的 `automaticLookupEnabled` 默认按 `false` 处理。

## WordCaptureController 设计

Controller 始终只维护一个 `SelectionHook` 实例：

```ts
private selectionHook?: SelectionHookInstance
private automaticLookupEnabled = false

private lastAutomaticLookup?: {
  text: string
  timestamp: number
}
```

### 初始化 SelectionHook

事件监听只注册一次，避免窗口重建或开关切换后重复触发：

```ts
private getSelectionHook(): SelectionHookInstance {
  if (!this.selectionHook) {
    const SelectionHook =
      require('selection-hook') as SelectionHookConstructor

    this.selectionHook = new SelectionHook()
    this.selectionHook.on('text-selection', this.handleTextSelection)
    this.selectionHook.on('error', (error) => {
      console.error('Selection hook error', error)
    })
  }

  return this.selectionHook
}
```

### 启动

启动窗口取词服务时先加载设置，再确定 passive mode：

```ts
hook.start({
  selectionPassiveMode: !this.automaticLookupEnabled
})
```

全局快捷键在两种模式下都注册。

### 切换自动划词

```ts
setAutomaticLookup(enabled: boolean): WordCaptureStatus {
  this.automaticLookupEnabled = enabled

  const hook = this.getSelectionHook()
  if (hook.isRunning()) {
    hook.setSelectionPassiveMode(!enabled)
  }

  this.saveSettings()
  return this.getStatus()
}
```

事件可能已经进入队列，因此 `handleTextSelection` 内仍需再次检查 `automaticLookupEnabled`。

### 自动划词事件

直接使用事件携带的 `selection.text`，不要再次调用 `getCurrentSelection()`：

```ts
private readonly handleTextSelection = (
  selection: TextSelectionData
): void => {
  if (!this.automaticLookupEnabled) return
  this.processSelectedText(selection.text, 'automatic')
}
```

### 快捷键取词

快捷键继续主动获取当前选区：

```ts
const selection = this.getSelectionHook().getCurrentSelection()
this.processSelectedText(selection?.text, 'shortcut')
```

### 统一文本处理

```ts
type CaptureSource = 'automatic' | 'shortcut'

private processSelectedText(
  value: string | undefined,
  source: CaptureSource
): void {
  const text = value?.trim()

  if (!text) {
    if (source === 'shortcut') this.showAndSend({ type: 'empty' })
    return
  }

  if (text.length > MAX_SELECTION_LENGTH) {
    if (source === 'shortcut') {
      this.showAndSend({ type: 'error', message: '选中的文本过长。' })
    }
    return
  }

  if (source === 'automatic' && this.shouldIgnoreAutomaticLookup(text)) {
    return
  }

  this.showAndSend({ type: 'lookup', text })
}
```

自动划词中的空内容和过长文本应静默忽略，避免用户正常拖选段落时频繁收到错误提示。

## 防重复与防止自身触发

自动划词至少应用以下规则：

1. 忽略空白文本。
2. 忽略超过最大长度的文本。
3. 忽略 Dictol 自己窗口中的选择。
4. 约 400ms 内忽略相同文本的重复事件。
5. 开关关闭后，即使收到已排队事件也不处理。

```ts
private shouldIgnoreAutomaticLookup(text: string): boolean {
  if (BrowserWindow.getFocusedWindow() === this.window) return true

  const timestamp = Date.now()
  if (
    this.lastAutomaticLookup?.text === text &&
    timestamp - this.lastAutomaticLookup.timestamp < 400
  ) {
    return true
  }

  this.lastAutomaticLookup = { text, timestamp }
  return false
}
```

忽略自身窗口可以避免解释区的文本选择同时触发 DictionaryView 内部查词和跨软件划词。

## IPC

新增主进程 handler：

```ts
ipcMain.handle('word-capture:set-automatic-lookup', (event, enabled: boolean) => {
  if (!wordCaptureController.acceptsSender(event.sender)) return null
  if (typeof enabled !== 'boolean') return null
  return wordCaptureController.setAutomaticLookup(enabled)
})
```

Preload API：

```ts
setAutomaticLookup(enabled: boolean): Promise<WordCaptureStatus | null>
```

Renderer 在设置页面使用 shadcn `Switch`：

- 初始值来自 `word-capture:status`。
- mutation 成功后用返回的新状态刷新界面。
- 修改失败时恢复原开关值并展示错误提示。

## 生命周期

```text
创建窗口
  → 创建或复用 SelectionHook
  → 注册一次事件监听
  → 根据设置调用 start()
  → 注册全局快捷键

切换自动划词
  → setSelectionPassiveMode()
  → 保存设置

窗口关闭
  → stop()

macOS 重新创建窗口
  → start()，复用同一个 SelectionHook

应用退出
  → stop()
  → cleanup()
```

不要在切换开关时创建新的 `SelectionHook`，也不要在普通窗口关闭时调用 `cleanup()`；macOS 关闭窗口后应用仍可能继续运行并重新创建窗口。最终退出时才调用 `cleanup()`。

## 用户体验建议

- 自动划词默认关闭，避免安装后立即产生侵入式行为。
- 快捷键始终可用，作为自动划词失败时的保底能力。
- 自动划词只对外部应用生效；Dictol 内继续使用现有的右键/选中文本查词菜单。
- 自动查词导致窗口频繁抢焦点时，可进一步增加“自动显示但不聚焦”的窗口策略。
- `selection-hook` 默认允许剪贴板 fallback。若之后提供“绝不修改剪贴板”设置，可对应 `enableClipboard: false`，但会降低部分应用的兼容性。

## 跨平台限制

| 平台          | 支持情况 | 注意事项                                                                 |
| ------------- | -------- | ------------------------------------------------------------------------ |
| Windows       | 完整支持 | 某些应用可能使用剪贴板 fallback                                          |
| macOS         | 完整支持 | 必须授予辅助功能权限                                                     |
| Linux X11     | 支持较好 | 文本范围坐标能力弱于 Windows/macOS                                       |
| Linux Wayland | 有限制   | GNOME Wayland 可能完全不可用，其他 compositor 可能缺少坐标或输入设备权限 |

设置页面应根据 `supported`、`trusted` 和平台环境展示说明。即使自动划词不可用，也应尽量保留快捷键取词能力。

## 实施顺序

1. 扩展 `WordCaptureSettings` 和 `WordCaptureStatus`。
2. 给 `WordCaptureController` 增加自动模式状态和事件监听。
3. 抽取统一的文本校验与发送逻辑。
4. 实现自身窗口过滤、重复事件抑制。
5. 增加 IPC 和 Preload API。
6. 在设置页面增加开关。
7. 分别验证快捷键模式、自动模式、运行时切换和应用重启恢复。
8. 在 Windows、macOS、Linux X11/Wayland 上分别验证并记录降级行为。
