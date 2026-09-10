import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'

import {
  AI_TRANSLATION_LANGUAGES,
  type AiChatRequest,
  type AiLookupPublicConfig,
  type AiSaveConfigRequest
} from '../../shared/ai-ipc'
import { LANGUAGE_TASK_KINDS } from '../../shared/language-task'
import { AppRuntime } from '../app-runtime'
import { AiLookupService } from '../ai-service'
import { BaseController } from './base-controller'

const MAX_REQUEST_ID_LENGTH = 160

export class AiController extends BaseController {
  private readonly service: AiLookupService

  constructor(runtime: AppRuntime) {
    super(runtime)
    this.service = this.runtime.aiLookupService
  }

  override mount(): void {
    ipcMain.handle('ai-lookup:get-config', this.getConfig)
    ipcMain.handle('ai-lookup:save-config', this.saveConfig)
    ipcMain.handle('ai-lookup:start-chat', this.startChat)
    ipcMain.on('ai-lookup:cancel', this.cancel)
  }

  private readonly getConfig = (event: IpcMainInvokeEvent): AiLookupPublicConfig | null => {
    if (!this.acceptsMainSender(event.sender)) return null
    return this.service.getPublicConfig()
  }

  private readonly saveConfig = (
    event: IpcMainInvokeEvent,
    request: AiSaveConfigRequest
  ): AiLookupPublicConfig | null => {
    if (!this.acceptsMainSender(event.sender)) return null
    if (!isSaveConfigRequest(request)) throw new Error('AI 设置格式无效。')
    const config = this.service.saveConfig(request)
    this.runtime.activeDictionaryView?.send(
      'dictionary-view:ai-explanation-availability-changed',
      config.enabled
    )
    return config
  }

  private readonly startChat = (
    event: IpcMainInvokeEvent,
    request: AiChatRequest
  ): string | null => {
    if (!this.acceptsMainSender(event.sender)) return null
    if (!isChatRequest(request)) throw new Error('AI 请求格式无效。')
    const requestId = randomUUID()
    const sender = event.sender
    this.service.start(
      requestId,
      request.messages,
      request.promptTarget ?? 'sidebar',
      (streamEvent) => {
        if (!sender.isDestroyed()) sender.send('ai-lookup:event', { requestId, ...streamEvent })
      },
      request.translation,
      request.languageTask
    )
    return requestId
  }

  private readonly cancel = (event: IpcMainEvent, requestId: unknown): void => {
    if (!this.acceptsMainSender(event.sender)) return
    if (typeof requestId !== 'string' || requestId.length > MAX_REQUEST_ID_LENGTH) return
    this.service.cancel(requestId)
  }

  private acceptsMainSender(sender: Electron.WebContents): boolean {
    const mainWindow = this.runtime.mainWindow
    return Boolean(
      mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === sender.id
    )
  }
}

function isChatRequest(value: unknown): value is AiChatRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as AiChatRequest
  if (!Array.isArray(request.messages) || request.messages.length === 0) return false
  if (
    request.promptTarget !== undefined &&
    request.promptTarget !== 'sidebar' &&
    request.promptTarget !== 'selection-toolbar' &&
    request.promptTarget !== 'translation'
  ) {
    return false
  }
  if (request.promptTarget === 'translation') {
    return (
      request.translation !== undefined &&
      AI_TRANSLATION_LANGUAGES.includes(request.translation.sourceLanguage) &&
      AI_TRANSLATION_LANGUAGES.includes(request.translation.targetLanguage) &&
      request.translation.sourceLanguage !== request.translation.targetLanguage &&
      request.languageTask === undefined
    )
  }
  if (request.translation !== undefined || !request.languageTask) return false
  const sourceText = request.languageTask.sourceText
  if (typeof sourceText !== 'string' || !sourceText.trim() || sourceText.length > 20_000)
    return false
  return (
    request.languageTask.task === undefined ||
    LANGUAGE_TASK_KINDS.includes(request.languageTask.task)
  )
}

function isSaveConfigRequest(value: unknown): value is AiSaveConfigRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as AiSaveConfigRequest
  return (
    typeof request.enabled === 'boolean' &&
    request.provider === 'openai-compatible' &&
    typeof request.baseUrl === 'string' &&
    typeof request.model === 'string' &&
    (request.apiKey === undefined || typeof request.apiKey === 'string')
  )
}
