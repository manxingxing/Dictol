import {
  ipcMain,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'

import { LOOKUP_WORD_ON_SHORTCUT } from '../app-runtime'
import type { AppConfig } from '../app-config'
import { BaseController } from './base-controller'

export type WordCaptureStatus = {
  supported: boolean
  limitation: string | null
  trusted: boolean
  registered: boolean
  shortcut: string
  lookupWordOnSelection: boolean
  selectionDictionaryGroupId: string | null
  excludedPrograms: string[]
}

export type WordCaptureShortcutResult = {
  ok: boolean
  status: WordCaptureStatus
  error?: string
}

export type OpenInputMonitoringSettingsResult = {
  ok: boolean
  error?: string
}

const MACOS_INPUT_MONITORING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'

export class WordCaptureController extends BaseController {
  override mount(): void {
    ipcMain.handle('word-capture:status', this.getStatus)
    ipcMain.handle('word-capture:request-access', this.requestAccess)
    ipcMain.handle('word-capture:open-input-monitoring-settings', this.openInputMonitoringSettings)
    ipcMain.handle('word-capture:set-shortcut', this.setShortcut)
    ipcMain.handle('word-capture:set-selection-enabled', this.setSelectionEnabled)
    ipcMain.handle('word-capture:set-selection-dictionary-group', this.setSelectionDictionaryGroup)
    ipcMain.handle('word-capture:remove-excluded-program', this.removeExcludedProgram)
  }

  getStatus = (event: IpcMainInvokeEvent): WordCaptureStatus | null => {
    if (!this.acceptsSender(event.sender)) return null
    return this.createStatus()
  }

  requestAccess = (event: IpcMainInvokeEvent): WordCaptureStatus | null => {
    if (!this.acceptsSender(event.sender)) return null
    if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true)
    return this.createStatus()
  }

  openInputMonitoringSettings = async (
    event: IpcMainInvokeEvent
  ): Promise<OpenInputMonitoringSettingsResult | null> => {
    if (!this.acceptsSender(event.sender)) return null
    if (process.platform !== 'darwin') {
      return { ok: false, error: '输入监控设置仅适用于 macOS。' }
    }

    try {
      await shell.openExternal(MACOS_INPUT_MONITORING_SETTINGS_URL)
      return { ok: true }
    } catch (error) {
      console.error('Failed to open macOS input monitoring settings', error)
      return {
        ok: false,
        error: '无法打开系统设置，请手动前往“隐私与安全性 > 输入监控”。'
      }
    }
  }

  setShortcut = (event: IpcMainInvokeEvent, shortcut: string): WordCaptureShortcutResult | null => {
    if (!this.acceptsSender(event.sender)) return null
    if (typeof shortcut !== 'string' || !shortcut.trim() || shortcut.length > 64) {
      return {
        ok: false,
        status: this.createStatus(),
        error: '无效的快捷键。'
      }
    }
    if (!this.isSupported()) {
      return {
        ok: false,
        status: this.createStatus(),
        error: '当前平台暂不支持快捷键取词。'
      }
    }

    const previousConfig = this.runtime.appConfig.load()
    const nextConfig: AppConfig = {
      ...previousConfig,
      shortcuts: {
        ...previousConfig.shortcuts,
        lookupWordOnShortcut: shortcut.trim()
      }
    }

    try {
      this.runtime.appConfig.save(nextConfig)
      this.runtime.restartInputServices()

      if (
        nextConfig.featureFlags.lookupWordOnShortcut &&
        !this.runtime.shortcutRegister.isRegistered(LOOKUP_WORD_ON_SHORTCUT)
      ) {
        throw new Error('快捷键不可用')
      }

      return { ok: true, status: this.createStatus() }
    } catch (error) {
      console.error('Failed to update word capture shortcut', { shortcut, error })
      this.restoreConfig(previousConfig)
      return {
        ok: false,
        status: this.createStatus(),
        error: '这个快捷键无效或已被系统、其他应用占用。'
      }
    }
  }

  setSelectionEnabled = (
    event: IpcMainInvokeEvent,
    enabled: boolean
  ): WordCaptureShortcutResult | null => {
    if (!this.acceptsSender(event.sender)) return null
    if (typeof enabled !== 'boolean') {
      return { ok: false, status: this.createStatus(), error: '无效的实时取词设置。' }
    }

    const previousConfig = this.runtime.appConfig.load()
    const nextConfig: AppConfig = {
      ...previousConfig,
      featureFlags: {
        ...previousConfig.featureFlags,
        lookupWordOnSelection: enabled
      }
    }

    try {
      this.runtime.appConfig.save(nextConfig)
      this.runtime.restartInputServices()
      if (enabled && !this.runtime.selectionHookService.getStatus().running) {
        throw new Error('实时取词服务不可用')
      }
      return { ok: true, status: this.createStatus() }
    } catch (error) {
      console.error('Failed to update selection lookup setting', { enabled, error })
      this.restoreConfig(previousConfig)
      return {
        ok: false,
        status: this.createStatus(),
        error: '无法更新实时取词设置。'
      }
    }
  }

  setSelectionDictionaryGroup = async (
    event: IpcMainInvokeEvent,
    groupId: unknown
  ): Promise<WordCaptureShortcutResult | null> => {
    if (!this.acceptsSender(event.sender)) return null
    if (groupId !== null && typeof groupId !== 'string') {
      return { ok: false, status: this.createStatus(), error: '无效的取词组。' }
    }
    const numericGroupId = groupId === null ? undefined : Number(groupId)
    if (
      numericGroupId !== undefined &&
      (!Number.isSafeInteger(numericGroupId) || numericGroupId <= 0)
    ) {
      return { ok: false, status: this.createStatus(), error: '无效的取词组。' }
    }
    if (numericGroupId !== undefined) {
      const groups = await this.db.listDictionaryGroups()
      if (!groups.some((group) => group.id === String(numericGroupId))) {
        return { ok: false, status: this.createStatus(), error: '词典组不存在。' }
      }
    }

    const previousConfig = this.runtime.appConfig.load()
    const nextConfig: AppConfig = {
      ...previousConfig,
      selection: {
        ...previousConfig.selection,
        dictionaryGroupId: numericGroupId
      }
    }
    try {
      this.runtime.appConfig.save(nextConfig)
      this.runtime.selectionDictionaryGroupId = numericGroupId
      return { ok: true, status: this.createStatus() }
    } catch (error) {
      console.error('Failed to update selection dictionary group', { groupId, error })
      return { ok: false, status: this.createStatus(), error: '无法更新取词组。' }
    }
  }

  removeExcludedProgram = (
    event: IpcMainInvokeEvent,
    programName: string
  ): WordCaptureShortcutResult | null => {
    if (!this.acceptsSender(event.sender)) return null

    try {
      this.runtime.appConfig.removeExcludedProgram(programName)
      this.runtime.restartInputServices()
      return { ok: true, status: this.createStatus() }
    } catch (error) {
      console.error('Failed to remove excluded selection program', { programName, error })
      return {
        ok: false,
        status: this.createStatus(),
        error: '无法从排除列表中删除这个程序。'
      }
    }
  }

  private restoreConfig(config: AppConfig): void {
    try {
      this.runtime.appConfig.save(config)
      this.runtime.restartInputServices()
    } catch (error) {
      console.error('Failed to restore word capture configuration', error)
    }
  }

  private createStatus(): WordCaptureStatus {
    const config = this.runtime.appConfig.load()
    const capabilities = this.runtime.selectionHookService.getCapabilities()
    return {
      supported: capabilities.supported,
      limitation: capabilities.limitation,
      trusted: this.isTrusted(),
      registered: this.runtime.shortcutRegister.isRegistered(LOOKUP_WORD_ON_SHORTCUT),
      shortcut: config.shortcuts.lookupWordOnShortcut,
      lookupWordOnSelection: config.featureFlags.lookupWordOnSelection,
      selectionDictionaryGroupId:
        this.runtime.selectionDictionaryGroupId === undefined
          ? null
          : String(this.runtime.selectionDictionaryGroupId),
      excludedPrograms: [...config.selection.excludedPrograms]
    }
  }

  private acceptsSender(sender: WebContents): boolean {
    const window = this.runtime.mainWindow
    return Boolean(window && !window.isDestroyed() && window.webContents.id === sender.id)
  }

  private isSupported(): boolean {
    return this.runtime.selectionHookService.getCapabilities().supported
  }

  private isTrusted(): boolean {
    if (!this.isSupported()) return false
    return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false)
  }
}
