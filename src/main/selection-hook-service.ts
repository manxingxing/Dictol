import type {
  KeyboardEventData,
  MouseEventData,
  MouseWheelEventData,
  SelectionHookConstructor,
  SelectionHookInstance,
  TextSelectionData
} from 'selection-hook'
import { EventEmitter } from 'node:events'

import type { ShortcutHandler } from './shortcut-register'

export type SelectionHookConfig = {
  passiveMode: boolean
  excludedPrograms: string[]
}

export type SelectionSource = 'shortcut' | 'selection'

export type CapturedSelection = {
  source: SelectionSource
  selection: TextSelectionData
}

export type SelectionHookStatus = {
  running: boolean
  passiveMode: boolean
}

export type SelectionHookCapabilities = {
  supported: boolean
  limitation: string | null
}

export type SelectionListener = (capture: CapturedSelection) => void
export type SelectionUnavailableListener = (source: SelectionSource) => void
export type KeyDownListener = (event: KeyboardEventData) => void
export type MouseDownListener = (event: MouseEventData) => void
export type MouseWheelListener = (event: MouseWheelEventData) => void
type SelectionHookEvents = {
  'text-selection': [capture: CapturedSelection]
  'selection-unavailable': [source: SelectionSource]
}

export class SelectionHookService implements ShortcutHandler {
  readonly eventBus = new EventEmitter<SelectionHookEvents>()
  private hook: SelectionHookInstance | undefined
  private config: SelectionHookConfig = { passiveMode: true, excludedPrograms: [] }

  start(config: SelectionHookConfig): SelectionHookStatus {
    const nextConfig = validateConfig(config)
    // passive mode 只供快捷键主动读取选区，不能保留实时取词的程序过滤，
    // 否则被排除程序中的快捷键取词也会被原生 hook 拦截。
    const appliedConfig: SelectionHookConfig = {
      ...nextConfig,
      excludedPrograms: nextConfig.passiveMode ? [] : nextConfig.excludedPrograms
    }

    try {
      const hook = this.getHook()
      const filterMode = appliedConfig.excludedPrograms.length > 0 ? 2 : 0
      if (!hook.setGlobalFilterMode(filterMode, appliedConfig.excludedPrograms)) {
        console.error('Failed to update selection hook global filter')
        this.stop()
        return this.getStatus()
      }
      if (!hook.setSelectionPassiveMode(nextConfig.passiveMode)) {
        console.error(`Failed to set selection passive mode to ${nextConfig.passiveMode}`)
        this.stop()
        return this.getStatus()
      }

      this.config = appliedConfig
      if (!hook.isRunning() && !hook.start()) {
        console.error('Failed to start selection hook')
      }
    } catch (error) {
      console.error('Failed to initialize selection hook', error)
      this.stop()
    }
    return this.getStatus()
  }

  stop(): void {
    if (this.hook?.isRunning()) this.hook.stop()
  }

  restart(config: SelectionHookConfig): SelectionHookStatus {
    return this.start(config)
  }

  dispose(): void {
    this.stop()
    this.hook?.cleanup()
    this.hook = undefined
    this.eventBus.removeAllListeners()
  }

  handleShortcut(): void {
    const selection = this.getCurrentSelection()
    if (selection) {
      this.emitSelection(selection, 'shortcut')
      return
    }
    this.eventBus.emit('selection-unavailable', 'shortcut')
  }

  getCurrentSelection(): TextSelectionData | null {
    if (!this.hook?.isRunning()) return null
    return this.hook.getCurrentSelection()
  }

  getStatus(): SelectionHookStatus {
    return {
      running: this.hook?.isRunning() ?? false,
      passiveMode: this.config.passiveMode
    }
  }

  getCapabilities(): SelectionHookCapabilities {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      return { supported: true, limitation: null }
    }
    if (process.platform !== 'linux') {
      return { supported: false, limitation: '当前操作系统不受 selection-hook 支持。' }
    }

    try {
      const environment = this.getHook().linuxGetEnvInfo()
      if (!environment) {
        return { supported: false, limitation: '无法识别当前 Linux 图形环境。' }
      }
      const usesWayland = environment.displayProtocol === 2
      if (usesWayland && environment.compositorType === 2) {
        return {
          supported: false,
          limitation: 'GNOME Wayland 不提供实时选区协议；请切换到 X11 会话后使用取词功能。'
        }
      }
      if (usesWayland && !environment.hasInputDeviceAccess) {
        return {
          supported: true,
          limitation: '当前 Wayland 会话没有输入设备权限，实时取词仍可用，但检测会有短暂延迟。'
        }
      }
      return { supported: true, limitation: null }
    } catch (error) {
      console.error('Failed to inspect selection hook capabilities', error)
      return { supported: false, limitation: 'selection-hook 原生模块无法在当前系统中加载。' }
    }
  }

  onSelection(listener: SelectionListener): () => void {
    this.eventBus.on('text-selection', listener)
    return () => this.eventBus.off('text-selection', listener)
  }

  onSelectionUnavailable(listener: SelectionUnavailableListener): () => void {
    this.eventBus.on('selection-unavailable', listener)
    return () => this.eventBus.off('selection-unavailable', listener)
  }

  onKeyDown(listener: KeyDownListener): () => void {
    const hook = this.getHook()
    hook.on('key-down', listener)
    return () => hook.off('key-down', listener)
  }

  onMouseDown(listener: MouseDownListener): () => void {
    const hook = this.getHook()
    hook.on('mouse-down', listener)
    return () => hook.off('mouse-down', listener)
  }

  onMouseWheel(listener: MouseWheelListener): () => void {
    const hook = this.getHook()
    hook.on('mouse-wheel', listener)
    return () => hook.off('mouse-wheel', listener)
  }

  private getHook(): SelectionHookInstance {
    if (!this.hook) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SelectionHook = require('selection-hook') as SelectionHookConstructor
      this.hook = new SelectionHook()
      this.hook.on('text-selection', this.handleTextSelection)
      this.hook.on('error', this.handleError)
    }
    return this.hook
  }

  private emitSelection(selection: TextSelectionData, source: SelectionSource): void {
    this.eventBus.emit('text-selection', { source, selection })
  }

  private readonly handleTextSelection = (selection: TextSelectionData): void => {
    if (this.config.passiveMode) return
    this.emitSelection(selection, 'selection')
  }

  private readonly handleError = (error: Error): void => {
    console.error('Selection hook error', error)
  }
}

function validateConfig(config: SelectionHookConfig): SelectionHookConfig {
  if (typeof config.passiveMode !== 'boolean') throw new Error('passiveMode 必须是 boolean')
  if (
    !Array.isArray(config.excludedPrograms) ||
    config.excludedPrograms.some((program) => typeof program !== 'string' || !program.trim())
  ) {
    throw new Error('excludedPrograms 必须是有效的程序名称数组')
  }
  return {
    passiveMode: config.passiveMode,
    excludedPrograms: [...config.excludedPrograms]
  }
}
