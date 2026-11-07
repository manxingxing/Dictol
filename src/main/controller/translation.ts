import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Point,
  type WebContents
} from 'electron'
import {
  TRANSLATION_LANGUAGES,
  type ClipboardTranslationSettingResult,
  type ClipboardTranslationStatus,
  type SelectionTranslationShortcutResult,
  type SelectionTranslationShortcutStatus,
  type TranslationLanguage,
  type TranslationPublicConfig,
  type TranslationRequest,
  type TranslationSaveProviderRequest
} from '../../shared/translation'
import { CLIPBOARD_TRANSLATION_SHORTCUT, TRANSLATE_SELECTION_SHORTCUT } from '../../shared/shortcuts'
import type { SelectionAnchor } from '../lib/selection-position'
import { BaseController } from './base-controller'

export class TranslationController extends BaseController {
  setOnVisibilityChange(callback: () => void): void {
    this.runtime.actions.translation.setOnVisibilityChange(callback)
  }

  override mount(): void {
    ipcMain.handle('translation:get-config', this.getConfig)
    ipcMain.handle('translation:save-provider', this.saveProvider)
    ipcMain.handle('translation:remove-provider', this.removeProvider)
    ipcMain.handle('translation:reorder-providers', this.reorderProviders)
    ipcMain.handle('translation:set-target-language', this.setTargetLanguage)
    ipcMain.handle('translation:test-provider', this.testProvider)
    ipcMain.handle('translation:list-models', this.listModels)
    ipcMain.handle('translation:test-draft', this.testDraft)
    ipcMain.handle('translation:selection-shortcut-status', this.handleSelectionShortcutStatus)
    ipcMain.handle('translation:set-selection-shortcut', this.setSelectionShortcut)
    ipcMain.handle('translation:clipboard-shortcut-status', this.handleClipboardShortcutStatus)
    ipcMain.handle('translation:set-clipboard-shortcut', this.setClipboardShortcut)
    ipcMain.handle('translation:start', this.start)
    ipcMain.on('translation:cancel', this.cancel)
    ipcMain.handle('selection-translation:toggle-pin', this.togglePin)
    ipcMain.on('selection-translation:desired-height', this.handleDesiredHeight)
  }

  showSelection(text: string, anchor?: SelectionAnchor): void {
    this.runtime.actions.translation.showSelection(text, anchor)
  }

  get isVisible(): boolean {
    return this.runtime.actions.translation.isVisible
  }

  hideIfOutside(point: Point): void {
    this.runtime.actions.translation.hideIfOutside(point)
  }

  private readonly togglePin = (event: IpcMainInvokeEvent): boolean => {
    if (!this.isTranslationSender(event.sender)) return false
    return this.runtime.actions.translation.togglePin()
  }

  hide(): void {
    this.runtime.actions.translation.hide()
  }

  private readonly handleDesiredHeight = (
    event: IpcMainEvent,
    version: number,
    desiredHeight: number
  ): void => {
    if (!this.isTranslationSender(event.sender)) return
    this.runtime.actions.translation.resizeSelectionWindow(version, desiredHeight)
  }

  private readonly getConfig = (event: IpcMainInvokeEvent): TranslationPublicConfig | null => {
    if (!this.acceptsSender(event.sender)) return null
    return this.runtime.translationService.getConfig()
  }

  private readonly handleSelectionShortcutStatus = (
    event: IpcMainInvokeEvent
  ): SelectionTranslationShortcutStatus | null => {
    if (!this.isMainSender(event.sender)) return null
    return this.getSelectionShortcutStatus()
  }

  private getSelectionShortcutStatus(): SelectionTranslationShortcutStatus {
    const config = this.runtime.appConfig.load()
    return {
      supported: this.runtime.selectionHookService.getCapabilities().supported,
      registered: this.runtime.shortcutRegister.isRegistered(TRANSLATE_SELECTION_SHORTCUT),
      shortcut: config.shortcuts.translateSelection
    }
  }

  private readonly setSelectionShortcut = (
    event: IpcMainInvokeEvent,
    shortcut: unknown
  ): SelectionTranslationShortcutResult | null => {
    if (!this.isMainSender(event.sender)) return null
    if (typeof shortcut !== 'string' || shortcut.length > 64)
      return { ok: false, status: this.getSelectionShortcutStatus(), error: '无效的快捷键。' }
    const normalized = shortcut.trim()
    const previous = this.runtime.appConfig.load()
    if (
      normalized === previous.shortcuts.translateSelection &&
      (!normalized || this.runtime.shortcutRegister.isRegistered(TRANSLATE_SELECTION_SHORTCUT))
    ) {
      return { ok: true, status: this.getSelectionShortcutStatus() }
    }
    if (normalized && !this.getSelectionShortcutStatus().supported)
      return {
        ok: false,
        status: this.getSelectionShortcutStatus(),
        error: '当前环境不支持选区翻译快捷键。'
      }
    this.runtime.appConfig.save({
      ...previous,
      shortcuts: { ...previous.shortcuts, translateSelection: normalized }
    })
    const registered = this.runtime.restartSelectionTranslationShortcut()
    if (normalized && !registered) {
      this.runtime.appConfig.save(previous)
      this.runtime.restartSelectionTranslationShortcut()
      return {
        ok: false,
        status: this.getSelectionShortcutStatus(),
        error: '这个快捷键无效或已被占用，请更换快捷键。'
      }
    }
    return { ok: true, status: this.getSelectionShortcutStatus() }
  }

  private readonly handleClipboardShortcutStatus = (
    event: IpcMainInvokeEvent
  ): ClipboardTranslationStatus | null => {
    if (!this.isMainSender(event.sender)) return null
    return this.getClipboardShortcutStatus()
  }

  private getClipboardShortcutStatus(): ClipboardTranslationStatus {
    const config = this.runtime.appConfig.load()
    return {
      supported: true,
      registered: this.runtime.shortcutRegister.isRegistered(CLIPBOARD_TRANSLATION_SHORTCUT),
      shortcut: config.shortcuts.clipboardTranslation
    }
  }

  private readonly setClipboardShortcut = (
    event: IpcMainInvokeEvent,
    shortcut: unknown
  ): ClipboardTranslationSettingResult | null => {
    if (!this.isMainSender(event.sender)) return null
    if (typeof shortcut !== 'string' || shortcut.length > 64)
      return { ok: false, status: this.getClipboardShortcutStatus(), error: '无效的快捷键。' }
    const normalized = shortcut.trim()
    const previous = this.runtime.appConfig.load()
    if (
      normalized === previous.shortcuts.clipboardTranslation &&
      (!normalized || this.runtime.shortcutRegister.isRegistered(CLIPBOARD_TRANSLATION_SHORTCUT))
    ) {
      return { ok: true, status: this.getClipboardShortcutStatus() }
    }
    this.runtime.appConfig.save({
      ...previous,
      shortcuts: { ...previous.shortcuts, clipboardTranslation: normalized }
    })
    const registered = this.runtime.restartClipboardTranslationShortcut()
    if (normalized && !registered) {
      this.runtime.appConfig.save(previous)
      this.runtime.restartClipboardTranslationShortcut()
      return {
        ok: false,
        status: this.getClipboardShortcutStatus(),
        error: '这个快捷键无效或已被占用，请更换快捷键。'
      }
    }
    return { ok: true, status: this.getClipboardShortcutStatus() }
  }

  private readonly saveProvider = (
    event: IpcMainInvokeEvent,
    request: TranslationSaveProviderRequest
  ): TranslationPublicConfig | null => {
    if (!this.isMainSender(event.sender)) return null
    return this.runtime.translationService.saveProvider(request)
  }

  private readonly removeProvider = (
    event: IpcMainInvokeEvent,
    id: string
  ): TranslationPublicConfig | null => {
    if (!this.isMainSender(event.sender)) return null
    return this.runtime.translationService.removeProvider(id)
  }

  private readonly reorderProviders = (
    event: IpcMainInvokeEvent,
    order: string[]
  ): TranslationPublicConfig | null => {
    if (!this.isMainSender(event.sender)) return null
    return this.runtime.translationService.reorderProviders(order)
  }

  private readonly setTargetLanguage = (
    event: IpcMainInvokeEvent,
    language: TranslationLanguage
  ): TranslationPublicConfig | null => {
    if (!this.isMainSender(event.sender)) return null
    if (!TRANSLATION_LANGUAGES.includes(language)) throw new Error('不支持的目标语言。')
    return this.runtime.translationService.setTargetLanguage(language)
  }

  private readonly testProvider = async (event: IpcMainInvokeEvent, id: string): Promise<void> => {
    if (!this.isMainSender(event.sender)) return
    await this.runtime.translationService.testProvider(id)
  }

  private readonly listModels = async (
    event: IpcMainInvokeEvent,
    input: { id: string; baseUrl: string; apiKey?: string }
  ): Promise<string[]> => {
    if (!this.isMainSender(event.sender)) return []
    if (
      !input ||
      typeof input.id !== 'string' ||
      typeof input.baseUrl !== 'string' ||
      (input.apiKey !== undefined && typeof input.apiKey !== 'string')
    )
      throw new Error('模型列表请求格式无效。')
    return this.runtime.translationService.listModels(input)
  }

  private readonly testDraft = async (
    event: IpcMainInvokeEvent,
    input: TranslationSaveProviderRequest
  ): Promise<void> => {
    if (!this.isMainSender(event.sender)) return
    await this.runtime.translationService.testDraft(input)
  }

  private readonly start = (
    event: IpcMainInvokeEvent,
    request: TranslationRequest
  ): string | null => {
    if (!this.acceptsSender(event.sender)) return null
    const sender = event.sender
    const requestId = this.runtime.translationService.start(request, (result) => {
      if (result.type !== 'delta')
        this.runtime.actions.translation.untrackPopupRequest(result.requestId)
      if (!sender.isDestroyed()) sender.send('translation:event', result)
    })
    if (this.isTranslationSender(sender))
      this.runtime.actions.translation.trackPopupRequest(requestId)
    return requestId
  }

  private readonly cancel = (event: IpcMainEvent, requestId: string): void => {
    if (!this.acceptsSender(event.sender) || typeof requestId !== 'string') return
    this.runtime.translationService.cancel(requestId)
    if (this.isTranslationSender(event.sender))
      this.runtime.actions.translation.untrackPopupRequest(requestId)
  }

  private acceptsSender(sender: WebContents): boolean {
    return this.isMainSender(sender) || this.isTranslationSender(sender)
  }

  private isMainSender(sender: WebContents): boolean {
    const window = this.runtime.mainWindow
    return Boolean(window && !window.isDestroyed() && window.webContents.id === sender.id)
  }

  private isTranslationSender(sender: WebContents): boolean {
    const window = this.runtime.windowManager.selectionTranslationWindow
    return Boolean(window && !window.isDestroyed() && window.webContents.id === sender.id)
  }
}
