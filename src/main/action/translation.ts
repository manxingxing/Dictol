import { screen, type BrowserWindow, type Point } from 'electron'
import {
  SELECTION_TRANSLATION_INITIAL_HEIGHT,
  SELECTION_TRANSLATION_MAX_HEIGHT,
  SELECTION_TRANSLATION_WIDTH,
  TRANSLATION_MAX_TEXT_LENGTH,
  type SelectionTranslationPayload
} from '../../shared/translation'
import type { AppRuntime } from '../app-runtime'
import {
  clamp,
  containsPoint,
  createCursorAnchor,
  fitExplanationNearSelection,
  toDisplayAnchor,
  type SelectionAnchor
} from '../lib/selection-position'
import { resolveRendererUrl } from '../output-path'
import { hideSelectionWindow, showSelectionWindowInactive } from '../selection-window-behavior'

/** Coordinates text translation and the floating translation window. */
export class TranslationActions {
  private anchor: SelectionAnchor | undefined
  private pendingPayload: SelectionTranslationPayload | undefined
  private loaded = false
  private webContentsId: number | undefined
  private selectionVersion = 0
  private pinned = false
  private readonly popupRequests = new Set<string>()
  private onVisibilityChange: (() => void) | undefined

  constructor(private readonly runtime: AppRuntime) {}

  setOnVisibilityChange(callback: () => void): void {
    this.onVisibilityChange = callback
  }

  translateCurrentSelection(): void {
    const selection = this.runtime.selectionHookService.getCurrentSelection()
    if (!selection) return
    this.showSelection(selection.text, toDisplayAnchor({ source: 'shortcut', selection }))
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
      const bounds = fitExplanationNearSelection(this.anchor ?? createCursorAnchor(), {
        width: SELECTION_TRANSLATION_WIDTH,
        height: SELECTION_TRANSLATION_INITIAL_HEIGHT
      })
      window.setBounds(bounds)
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

  togglePin(): boolean {
    this.pinned = !this.pinned
    return this.pinned
  }

  hide(): void {
    this.cancelPopupRequests()
    this.pinned = false
    hideSelectionWindow(this.runtime.windowManager.selectionTranslationWindow)
    this.onVisibilityChange?.()
  }

  trackPopupRequest(requestId: string): void {
    this.popupRequests.add(requestId)
  }

  untrackPopupRequest(requestId: string): void {
    this.popupRequests.delete(requestId)
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
      const width = Math.min(SELECTION_TRANSLATION_WIDTH, Math.max(1, workArea.width - margin * 2))
      window.setBounds({ y, width, height }, false)
    }
  }

  private flush(window: BrowserWindow): void {
    if (!this.pendingPayload || window.isDestroyed()) return
    window.webContents.send('selection-translation:update', this.pendingPayload)
    this.pendingPayload = undefined
    showSelectionWindowInactive(window, { mainWindowToKeepHidden: this.runtime.mainWindow })
    this.onVisibilityChange?.()
  }

  private cancelPopupRequests(): void {
    for (const requestId of this.popupRequests) this.runtime.translationService.cancel(requestId)
    this.popupRequests.clear()
  }
}
