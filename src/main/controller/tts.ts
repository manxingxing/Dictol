import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  TTS_MAX_TEXT_LENGTH,
  type OnlineTtsEngineId,
  type TtsConfig,
  type TtsSaveSettingsRequest
} from '../../shared/tts'
import { TtsService } from '../tts-service'
import { BaseController } from './base-controller'

export class TtsController extends BaseController {
  private readonly service = new TtsService()
  private readonly pending = new Map<string, AbortController>()

  override mount(): void {
    ipcMain.handle('tts:get-config', this.getConfig)
    ipcMain.handle('tts:get-credentials-status', this.getCredentialsStatus)
    ipcMain.handle('tts:save-config', this.saveConfig)
    ipcMain.handle('tts:save-settings', this.saveSettings)
    ipcMain.handle('tts:synthesize', this.synthesize)
    ipcMain.on('tts:abort', this.abort)
  }

  private readonly getConfig = (event: IpcMainInvokeEvent): TtsConfig | null =>
    this.acceptsReader(event.sender) ? this.runtime.appConfig.load().tts : null

  private readonly getCredentialsStatus = (
    event: IpcMainInvokeEvent
  ): Record<OnlineTtsEngineId, boolean> | null => {
    if (this.runtime.mainWindow?.webContents.id !== event.sender.id) return null
    const store = this.service.getCredentials()
    return {
      'openai-compatible': Boolean(store.get('openai-compatible')),
      elevenlabs: Boolean(store.get('elevenlabs')),
      'azure-speech': Boolean(store.get('azure-speech')),
      'fish-audio': Boolean(store.get('fish-audio'))
    }
  }

  private readonly saveConfig = (event: IpcMainInvokeEvent, request: unknown): TtsConfig | null => {
    if (this.runtime.mainWindow?.webContents.id !== event.sender.id) return null
    if (!isTtsConfig(request)) throw new Error('朗读设置格式无效。')
    const current = this.runtime.appConfig.load()
    this.runtime.appConfig.save({ ...current, tts: request })
    return this.runtime.appConfig.load().tts
  }

  private readonly saveSettings = (
    event: IpcMainInvokeEvent,
    request: unknown
  ): TtsConfig | null => {
    if (this.runtime.mainWindow?.webContents.id !== event.sender.id) return null
    if (!request || typeof request !== 'object' || !('config' in request))
      throw new Error('朗读设置格式无效。')
    const value = request as TtsSaveSettingsRequest
    if (!isTtsConfig(value.config)) throw new Error('朗读设置格式无效。')
    if (value.apiKey) {
      if (
        !isOnlineEngine(value.apiKey.provider) ||
        value.apiKey.provider !== value.config.engine ||
        typeof value.apiKey.value !== 'string' ||
        value.apiKey.value.length > 1000
      ) {
        throw new Error('API Key 格式无效。')
      }
      if (value.apiKey.value.trim())
        this.service.getCredentials().save(value.apiKey.provider, value.apiKey.value)
    }
    return this.saveConfig(event, value.config)
  }

  private readonly synthesize = async (
    event: IpcMainInvokeEvent,
    requestId: unknown,
    text: unknown
  ): Promise<Uint8Array> => {
    if (!this.acceptsReader(event.sender)) throw new Error('无权访问朗读服务。')
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100)
      throw new Error('朗读请求无效。')
    if (typeof text !== 'string' || !text.trim() || text.trim().length > TTS_MAX_TEXT_LENGTH)
      throw new Error(`朗读文本须为 1–${TTS_MAX_TEXT_LENGTH} 个字符。`)
    const key = `${event.sender.id}:${requestId}`
    if (this.pending.has(key)) throw new Error('朗读请求重复。')
    const controller = new AbortController()
    this.pending.set(key, controller)
    try {
      return await this.service.synthesize(
        text.trim(),
        this.runtime.appConfig.load().tts,
        controller.signal
      )
    } finally {
      this.pending.delete(key)
    }
  }

  private readonly abort = (event: Electron.IpcMainEvent, requestId: unknown): void => {
    if (typeof requestId === 'string') this.pending.get(`${event.sender.id}:${requestId}`)?.abort()
  }

  private acceptsReader(sender: WebContents): boolean {
    const id = sender.id
    const windows = this.runtime.windowManager
    return Boolean(
      this.runtime.mainWindow?.webContents.id === id ||
      windows.dictionaryView?.acceptsSender(id) ||
      windows.aggregateDictionaryView?.acceptsSender(id) ||
      windows.selectionTranslationWindow?.webContents.id === id ||
      windows.selectionExplanationWindow?.webContents.id === id ||
      windows.selectionExplanationView?.acceptsSender(id)
    )
  }
}

function isOnlineEngine(value: unknown): value is OnlineTtsEngineId {
  return (
    value === 'openai-compatible' ||
    value === 'elevenlabs' ||
    value === 'azure-speech' ||
    value === 'fish-audio'
  )
}

function isTtsConfig(value: unknown): value is TtsConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Partial<TtsConfig>
  const validString = (item: unknown, max: number): item is string =>
    typeof item === 'string' && item.length <= max
  return (
    (config.engine === 'system' || isOnlineEngine(config.engine)) &&
    (config.systemVoiceUri === null || validString(config.systemVoiceUri, 500)) &&
    !!config.openai &&
    validString(config.openai.baseUrl, 500) &&
    validString(config.openai.model, 200) &&
    validString(config.openai.voice, 200) &&
    !!config.elevenlabs &&
    validString(config.elevenlabs.model, 200) &&
    validString(config.elevenlabs.voiceId, 200) &&
    !!config.azure &&
    validString(config.azure.region, 100) &&
    validString(config.azure.voice, 200) &&
    !!config.fish &&
    validString(config.fish.model, 200) &&
    validString(config.fish.voiceId, 200)
  )
}
