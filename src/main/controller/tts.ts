import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

import type { TtsConfig } from '../../shared/tts'
import { BaseController } from './base-controller'

export class TtsController extends BaseController {
  override mount(): void {
    ipcMain.handle('tts:get-config', this.getConfig)
    ipcMain.handle('tts:save-config', this.saveConfig)
  }

  private readonly getConfig = (event: IpcMainInvokeEvent): TtsConfig | null => {
    if (!this.acceptsReader(event.sender)) return null
    return this.runtime.appConfig.load().tts
  }

  private readonly saveConfig = (event: IpcMainInvokeEvent, request: unknown): TtsConfig | null => {
    if (this.runtime.mainWindow?.webContents.id !== event.sender.id) return null
    if (!isTtsConfig(request)) throw new Error('朗读设置格式无效。')
    const current = this.runtime.appConfig.load()
    this.runtime.appConfig.save({ ...current, tts: request })
    return this.runtime.appConfig.load().tts
  }

  private acceptsReader(sender: WebContents): boolean {
    const id = sender.id
    const windows = this.runtime.windowManager
    return Boolean(
      this.runtime.mainWindow?.webContents.id === id ||
      windows.dictionaryView?.acceptsSender(id) ||
      windows.aggregateDictionaryView?.acceptsSender(id) ||
      windows.selectionExplanationWindow?.webContents.id === id ||
      windows.selectionExplanationView?.acceptsSender(id)
    )
  }
}

function isTtsConfig(value: unknown): value is TtsConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Partial<TtsConfig>
  return (
    config.engine === 'system' &&
    (config.systemVoiceUri === null ||
      (typeof config.systemVoiceUri === 'string' && config.systemVoiceUri.length <= 500))
  )
}
