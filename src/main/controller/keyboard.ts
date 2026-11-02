import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

import { SHOW_MAIN_WINDOW_SHORTCUT } from '../../shared/shortcuts'
import type { AppConfig } from '../app-config'
import { BaseController } from './base-controller'

export type MainWindowShortcutStatus = {
  shortcut: string
  registered: boolean
}

export type MainWindowShortcutResult = {
  ok: boolean
  status: MainWindowShortcutStatus
  error?: string
}

export class KeyboardController extends BaseController {
  // 当前正在进行快捷键捕获的窗口和令牌，格式为 `${sender.id}:${token}`。如果没有正在捕获，则为 `undefined`。
  private captureOwner: string | undefined
  private releaseCapture: (() => void) | undefined

  override mount(): void {
    ipcMain.handle('keyboard:status', this.getStatus)
    ipcMain.handle('keyboard:set-main-window-shortcut', this.setMainWindowShortcut)
    ipcMain.handle('keyboard:begin-shortcut-capture', this.beginShortcutCapture)
    ipcMain.handle('keyboard:end-shortcut-capture', this.endShortcutCapture)
  }

  private readonly beginShortcutCapture = (
    event: IpcMainInvokeEvent,
    token: unknown,
    command: unknown
  ): boolean => {
    if (
      !this.acceptsSender(event.sender) ||
      typeof token !== 'string' ||
      !token ||
      token.length > 128 ||
      typeof command !== 'string' ||
      !Object.hasOwn(this.runtime.appConfig.load().shortcuts, command)
    )
      return false
    const owner = `${event.sender.id}:${token}`
    if (this.captureOwner === owner) return true
    if (this.captureOwner) return false
    this.runtime.shortcutRegister.suspendAllShortCuts()

    const sender = event.sender
    const release = (): void => {
      if (this.captureOwner !== owner) return
      sender.removeListener('destroyed', release)
      sender.removeListener('did-start-navigation', release)
      this.captureOwner = undefined
      this.releaseCapture = undefined
      this.runtime.shortcutRegister.resumeAllShortCuts()
    }
    this.captureOwner = owner
    this.releaseCapture = release
    sender.once('destroyed', release)
    sender.once('did-start-navigation', release)
    return true
  }

  private readonly endShortcutCapture = (event: IpcMainInvokeEvent, token: unknown): boolean => {
    if (!this.acceptsSender(event.sender) || typeof token !== 'string') return false
    if (this.captureOwner !== `${event.sender.id}:${token}`) return false
    this.releaseCapture?.()
    return true
  }

  getStatus = (event: IpcMainInvokeEvent): MainWindowShortcutStatus | null => {
    if (!this.acceptsSender(event.sender)) return null
    return this.createStatus()
  }

  setMainWindowShortcut = (
    event: IpcMainInvokeEvent,
    shortcut: string
  ): MainWindowShortcutResult | null => {
    if (!this.acceptsSender(event.sender)) return null
    if (typeof shortcut !== 'string' || shortcut.length > 64) {
      return { ok: false, status: this.createStatus(), error: '无效的快捷键。' }
    }

    const normalized = shortcut.trim()
    const previousConfig = this.runtime.appConfig.load()
    if (
      normalized === previousConfig.shortcuts.showMainWindow &&
      (!normalized || this.runtime.shortcutRegister.isRegistered(SHOW_MAIN_WINDOW_SHORTCUT))
    ) {
      return { ok: true, status: this.createStatus() }
    }
    const nextConfig: AppConfig = {
      ...previousConfig,
      shortcuts: {
        ...previousConfig.shortcuts,
        showMainWindow: normalized
      }
    }

    try {
      this.runtime.appConfig.save(nextConfig)
      this.runtime.restartMainWindowShortcut()
      if (normalized && !this.runtime.shortcutRegister.isRegistered(SHOW_MAIN_WINDOW_SHORTCUT)) {
        throw new Error('快捷键不可用')
      }
      return { ok: true, status: this.createStatus() }
    } catch (error) {
      console.error('Failed to update main window shortcut', { shortcut, error })
      this.restoreConfig(previousConfig)
      return {
        ok: false,
        status: this.createStatus(),
        error: '这个快捷键无效或已被系统、其他应用占用。'
      }
    }
  }

  private createStatus(): MainWindowShortcutStatus {
    const config = this.runtime.appConfig.load()
    return {
      shortcut: config.shortcuts.showMainWindow,
      registered: this.runtime.shortcutRegister.isRegistered(SHOW_MAIN_WINDOW_SHORTCUT)
    }
  }

  private acceptsSender(sender: WebContents): boolean {
    const window = this.runtime.mainWindow
    return Boolean(window && !window.isDestroyed() && window.webContents.id === sender.id)
  }

  private restoreConfig(config: AppConfig): void {
    try {
      this.runtime.appConfig.save(config)
      this.runtime.restartMainWindowShortcut()
    } catch (error) {
      console.error('Failed to restore main window shortcut configuration', error)
    }
  }
}
