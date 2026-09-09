import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { EdgeTTS } from 'edge-tts-universal'
import { randomUUID } from 'node:crypto'

import type { TtsConfig, TtsSaveConfigRequest } from '../../shared/tts'
import { BaseController } from './base-controller'

const MAX_TTS_TEXT_LENGTH = 200
const TTS_REQUEST_TIMEOUT_MS = 6_000

export class TtsController extends BaseController {
  override mount(): void {
    ipcMain.handle('tts:get-config', this.getConfig)
    ipcMain.handle('tts:save-config', this.saveConfig)
    ipcMain.handle('entry:read-aloud', this.readAloud)
  }

  private readonly getConfig = (event: IpcMainInvokeEvent): TtsConfig | null => {
    if (!this.acceptsMainSender(event.sender)) return null
    return this.runtime.appConfig.load().tts
  }

  private readonly saveConfig = (event: IpcMainInvokeEvent, request: unknown): TtsConfig | null => {
    if (!this.acceptsMainSender(event.sender)) return null
    if (!isTtsSaveConfigRequest(request)) throw new Error('朗读设置格式无效。')

    const edgeVoice = normalizeConfiguredVoice(request.edgeVoice)
    if (!edgeVoice) throw new Error('请填写默认 Edge voice。')

    const current = this.runtime.appConfig.load()
    this.runtime.appConfig.save({
      ...current,
      tts: { edgeVoice }
    })
    return this.runtime.appConfig.load().tts
  }

  private readonly readAloud = async (
    event: IpcMainInvokeEvent,
    text: unknown,
    voice: unknown
  ): Promise<Uint8Array | null> => {
    const requestId = randomUUID()
    const startedAt = Date.now()
    const rawText = typeof text === 'string' ? text : `<${typeof text}>`
    const normalizedVoice = normalizeTtsVoice(voice)
    const configuredVoice = this.runtime.appConfig.load().tts.edgeVoice
    const effectiveVoice = normalizedVoice ?? configuredVoice
    const textLength = typeof text === 'string' ? text.trim().length : 0
    const context = {
      requestId,
      senderId: event.sender.id,
      textLength,
      voice: effectiveVoice,
      voiceSource: normalizedVoice ? 'request' : 'settings',
      timeoutMs: TTS_REQUEST_TIMEOUT_MS
    }

    console.debug('[TTS] request received', { ...context, text: rawText })

    const normalizedText = normalizeTtsText(text)
    if (!normalizedText) {
      console.warn('[TTS] request rejected: invalid text', {
        ...context,
        text: rawText,
        reason: getInvalidTextReason(text)
      })
      return null
    }

    try {
      const tts = new EdgeTTS(normalizedText, effectiveVoice)
      const synthesis = await withTimeout(tts.synthesize(), TTS_REQUEST_TIMEOUT_MS)
      const audio = Buffer.from(await synthesis.audio.arrayBuffer())
      if (audio.length === 0) {
        throw new Error('朗读服务未返回音频。')
      }

      console.debug('[TTS] request completed', {
        ...context,
        audioBytes: audio.length,
        audioMimeType: synthesis.audio.type,
        subtitleCount: synthesis.subtitle.length,
        durationMs: Date.now() - startedAt
      })
      return Uint8Array.from(audio)
    } catch (error) {
      console.error(
        '[TTS] request failed',
        { ...context, text: rawText, durationMs: Date.now() - startedAt },
        error
      )
      throw error
    }
  }

  private acceptsMainSender(sender: WebContents): boolean {
    const mainWindow = this.runtime.mainWindow
    return Boolean(
      mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === sender.id
    )
  }
}

function normalizeTtsText(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const text = value.trim()
  return text.length > 0 && text.length <= MAX_TTS_TEXT_LENGTH ? text : null
}

function normalizeTtsVoice(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const voice = value.trim()
  return voice || undefined
}

function normalizeConfiguredVoice(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const voice = value.trim()
  return voice && voice.length <= 200 ? voice : null
}

function isTtsSaveConfigRequest(value: unknown): value is TtsSaveConfigRequest {
  return Boolean(value && typeof value === 'object' && 'edgeVoice' in value)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`朗读请求超过 ${timeoutMs / 1_000} 秒未响应。`))
    }, timeoutMs)

    void promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function getInvalidTextReason(value: unknown): string {
  if (typeof value !== 'string') return `text is not a string: ${typeof value}`
  if (!value.trim()) return 'text is empty after trim'
  if (value.trim().length > MAX_TTS_TEXT_LENGTH) {
    return `text length ${value.trim().length} exceeds ${MAX_TTS_TEXT_LENGTH}`
  }
  return 'unknown validation failure'
}
