import {
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Point,
  type WebContents
} from 'electron'
import {
  SELECTION_TRANSLATION_INITIAL_HEIGHT,
  SELECTION_TRANSLATION_MAX_HEIGHT,
  TRANSLATION_LANGUAGES,
  TRANSLATION_MAX_TEXT_LENGTH,
  type SelectionTranslationPayload,
  type TranslationLanguage,
  type TranslationPublicConfig,
  type TranslationRequest,
  type TranslationSaveProviderRequest
} from '../../shared/translation'
import {
  clamp,
  createCursorAnchor,
  fitExplanationNearSelection,
  containsPoint,
  type SelectionAnchor
} from '../lib/selection-position'
import { resolveRendererUrl } from '../output-path'
import { hideSelectionWindow, showSelectionWindowInactive } from '../selection-window-behavior'
import { BaseController } from './base-controller'

export class TranslationController extends BaseController {
  private anchor: SelectionAnchor | undefined
  private pendingPayload: SelectionTranslationPayload | undefined
  private loaded = false
  private webContentsId: number | undefined
  private selectionVersion = 0
  private pinned = false
  private readonly popupRequests = new Set<string>()
  private onVisibilityChange: (() => void) | undefined

  setOnVisibilityChange(callback: () => void): void {
    this.onVisibilityChange = callback
  }

  override mount(): void {
    ipcMain.handle('translation:get-config', this.getConfig)
    ipcMain.handle('translation:save-provider', this.saveProvider)
    ipcMain.handle('translation:remove-provider', this.removeProvider)
    ipcMain.handle('translation:reorder-providers', this.reorderProviders)
    ipcMain.handle('translation:set-target-language', this.setTargetLanguage)
    ipcMain.handle('translation:test-provider', this.testProvider)
    ipcMain.handle('translation:start', this.start)
    ipcMain.on('translation:cancel', this.cancel)
    ipcMain.handle('selection-translation:toggle-pin', this.togglePin)
  }

  showSelection(text: string, anchor?: SelectionAnchor): void {
    if (!text.trim() || text.length > TRANSLATION_MAX_TEXT_LENGTH) return
    this.anchor = anchor
    this.pendingPayload = {
      text: text.trim(),
      version: ++this.selectionVersion,
      pinned: this.pinned
    }
    const window = this.runtime.windowManager.createSelectionTranslationWindow()
    if (this.webContentsId !== window.webContents.id) {
      this.webContentsId = window.webContents.id
      this.loaded = false
      window.webContents.on('did-finish-load', () => {
        this.loaded = true
        this.flush(window)
      })
      window.on('closed', () => {
        this.webContentsId = undefined
        this.loaded = false
        this.pendingPayload = undefined
        this.pinned = false
        this.onVisibilityChange?.()
      })
      window.on('hide', () => {
        this.cancelPopupRequests()
        this.onVisibilityChange?.()
      })
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      void window.loadURL(resolveRendererUrl('selection-translation.html')).catch((error) => {
        console.error('Failed to load translation window', error)
      })
    }
    if (!this.pinned) {
      window.setBounds(
        fitExplanationNearSelection(this.anchor ?? createCursorAnchor(), {
          width: 520,
          height: SELECTION_TRANSLATION_INITIAL_HEIGHT
        })
      )
    }
    if (this.loaded) this.flush(window)
  }

  get isVisible(): boolean {
    return Boolean(this.runtime.windowManager.selectionTranslationWindow?.isVisible())
  }

  hideIfOutside(point: Point): void {
    const window = this.runtime.windowManager.selectionTranslationWindow
    if (window?.isVisible() && !this.pinned && !containsPoint(window.getBounds(), point))
      this.hide()
  }

  private readonly togglePin = (event: IpcMainInvokeEvent): boolean => {
    if (!this.isTranslationSender(event.sender)) return false
    this.pinned = !this.pinned
    return this.pinned
  }

  private flush(window: Electron.BrowserWindow): void {
    if (!this.pendingPayload || window.isDestroyed()) return
    window.webContents.send('selection-translation:update', this.pendingPayload)
    this.pendingPayload = undefined
    showSelectionWindowInactive(window, { mainWindowToKeepHidden: this.runtime.mainWindow })
    this.onVisibilityChange?.()
  }

  hide(): void {
    this.cancelPopupRequests()
    this.pinned = false
    hideSelectionWindow(this.runtime.windowManager.selectionTranslationWindow)
    this.onVisibilityChange?.()
  }

  private cancelPopupRequests(): void {
    for (const requestId of this.popupRequests) this.runtime.translationService.cancel(requestId)
    this.popupRequests.clear()
  }

  resizeSelectionWindow(version: number, desiredHeight: number): void {
    if (version !== this.selectionVersion || !Number.isFinite(desiredHeight)) return
    const window = this.runtime.windowManager.selectionTranslationWindow
    if (!window || window.isDestroyed()) return
    const bounds = window.getBounds()
    const workArea = screen.getDisplayMatching(bounds).workArea
    const margin = 12
    const maximumHeight = Math.min(SELECTION_TRANSLATION_MAX_HEIGHT, workArea.height - margin * 2)
    const height = clamp(
      Math.ceil(desiredHeight),
      Math.min(SELECTION_TRANSLATION_INITIAL_HEIGHT, maximumHeight),
      maximumHeight
    )
    const y = clamp(bounds.y, workArea.y + margin, workArea.y + workArea.height - margin - height)
    if (height !== bounds.height || y !== bounds.y) {
      // Only resize vertically; resubmitting getBounds().width can make frameless windows grow on Windows.
      window.setBounds({ y, height }, false)
    }
  }

  private readonly getConfig = (event: IpcMainInvokeEvent): TranslationPublicConfig | null => {
    if (!this.acceptsSender(event.sender)) return null
    return this.runtime.translationService.getConfig()
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

  private readonly start = (
    event: IpcMainInvokeEvent,
    request: TranslationRequest
  ): string | null => {
    if (!this.acceptsSender(event.sender)) return null
    const sender = event.sender
    const requestId = this.runtime.translationService.start(request, (result) => {
      if (result.type !== 'delta') this.popupRequests.delete(result.requestId)
      if (!sender.isDestroyed()) sender.send('translation:event', result)
    })
    if (this.isTranslationSender(sender)) this.popupRequests.add(requestId)
    return requestId
  }

  private readonly cancel = (event: IpcMainEvent, requestId: string): void => {
    if (!this.acceptsSender(event.sender) || typeof requestId !== 'string') return
    this.runtime.translationService.cancel(requestId)
    if (this.isTranslationSender(event.sender)) this.popupRequests.delete(requestId)
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
