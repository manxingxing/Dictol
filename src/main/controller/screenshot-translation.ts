import { recognizeMacText, recognizeWindowsText } from '@dictol/ocr-native'
import {
  BrowserWindow,
  app,
  ipcMain,
  Notification,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents
} from 'electron'
import { OCR_SUPPORTED, SCREENSHOT_TRANSLATION_SHORTCUT, type AppRuntime } from '../app-runtime'
import { captureScreen } from '../ocr/screen-capture'
import { repairMergedEnglishWords, screenshotTranslationText } from '../ocr/ocr-translation'
import { resolvePreloadPath, resolveRendererUrl } from '../output-path'
import { TRANSLATION_MAX_TEXT_LENGTH } from '../../shared/translation'
import type {
  ScreenshotTranslationSettingResult,
  ScreenshotTranslationStatus
} from '../../shared/screenshot-translation'
import { createCursorAnchor } from '../lib/selection-position'
import { BaseController } from './base-controller'
import type { TranslationController } from './translation'

export class ScreenshotTranslationController extends BaseController {
  private overlays = new Map<number, { window: BrowserWindow; displayId: number }>()
  private progressWindow: BrowserWindow | undefined
  private busy = false

  constructor(
    runtime: AppRuntime,
    private readonly translation: TranslationController
  ) {
    super(runtime)
  }

  override mount(): void {
    this.runtime.screenshotTranslationHandler = () => this.toggleSelector()
    ipcMain.handle('screenshot-translation:status', this.getStatus)
    ipcMain.handle('screenshot-translation:set-enabled', this.setEnabled)
    ipcMain.handle('screenshot-translation:set-shortcut', this.setShortcut)
    ipcMain.on('screenshot-translation:complete', this.complete)
    ipcMain.on('screenshot-translation:cancel', this.cancel)
    app.once('before-quit', () => {
      this.closeOverlays()
      if (this.progressWindow && !this.progressWindow.isDestroyed()) this.progressWindow.destroy()
    })
  }

  private acceptsSender(sender: WebContents): boolean {
    return sender.id === this.runtime.mainWindow?.webContents.id
  }

  private status(): ScreenshotTranslationStatus {
    const config = this.runtime.appConfig.load()
    return {
      supported: OCR_SUPPORTED,
      enabled: config.featureFlags.screenshotTranslation,
      shortcut: config.shortcuts.screenshotTranslation,
      registered: this.runtime.shortcutRegister.isRegistered(SCREENSHOT_TRANSLATION_SHORTCUT)
    }
  }

  private readonly getStatus = (event: IpcMainInvokeEvent): ScreenshotTranslationStatus | null =>
    this.acceptsSender(event.sender) ? this.status() : null

  private readonly setEnabled = (
    event: IpcMainInvokeEvent,
    enabled: unknown
  ): ScreenshotTranslationSettingResult | null => {
    if (!this.acceptsSender(event.sender)) return null
    if (!OCR_SUPPORTED || typeof enabled !== 'boolean')
      return { ok: false, status: this.status(), error: '当前平台不支持截图翻译。' }
    const previous = this.runtime.appConfig.load()
    this.runtime.appConfig.save({
      ...previous,
      featureFlags: { ...previous.featureFlags, screenshotTranslation: enabled }
    })
    this.runtime.restartScreenshotTranslationShortcut()
    if (enabled && !this.runtime.shortcutRegister.isRegistered(SCREENSHOT_TRANSLATION_SHORTCUT)) {
      this.runtime.appConfig.save(previous)
      this.runtime.restartScreenshotTranslationShortcut()
      return { ok: false, status: this.status(), error: '截图翻译快捷键被其他应用占用。' }
    }
    if (!enabled) this.closeOverlays()
    return { ok: true, status: this.status() }
  }

  private readonly setShortcut = (
    event: IpcMainInvokeEvent,
    shortcut: unknown
  ): ScreenshotTranslationSettingResult | null => {
    if (!this.acceptsSender(event.sender)) return null
    if (typeof shortcut !== 'string' || !shortcut.trim() || shortcut.length > 64)
      return { ok: false, status: this.status(), error: '无效的截图翻译快捷键。' }
    const previous = this.runtime.appConfig.load()
    this.runtime.appConfig.save({
      ...previous,
      shortcuts: { ...previous.shortcuts, screenshotTranslation: shortcut.trim() }
    })
    this.runtime.restartScreenshotTranslationShortcut()
    if (
      previous.featureFlags.screenshotTranslation &&
      !this.runtime.shortcutRegister.isRegistered(SCREENSHOT_TRANSLATION_SHORTCUT)
    ) {
      this.runtime.appConfig.save(previous)
      this.runtime.restartScreenshotTranslationShortcut()
      return { ok: false, status: this.status(), error: '这个快捷键无效或已被占用。' }
    }
    return { ok: true, status: this.status() }
  }

  private async toggleSelector(): Promise<void> {
    if (this.overlays.size) {
      this.closeOverlays()
      return
    }
    if (this.busy) return
    const pointer = screen.getCursorScreenPoint()
    const activeDisplay = screen.getDisplayNearestPoint(pointer)
    const displays = screen.getAllDisplays()
    try {
      await Promise.all(
        displays.map(async (display) => {
          const window = new BrowserWindow({
            ...display.bounds,
            show: false,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: false,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
            webPreferences: {
              preload: resolvePreloadPath('screenshot-area.js'),
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true
            }
          })
          this.overlays.set(window.webContents.id, { window, displayId: display.id })
          window.setAlwaysOnTop(true, 'screen-saver')
          if (process.platform === 'darwin') {
            window.setVisibleOnAllWorkspaces(true, {
              visibleOnFullScreen: true,
              skipTransformProcessType: true
            })
          }
          await window.loadURL(resolveRendererUrl('screenshot-area.html'))
        })
      )
      if (!this.overlays.size) return
      for (const { window } of this.overlays.values()) {
        if (!window.isDestroyed()) window.show()
      }
      const active = [...this.overlays.values()].find(
        (entry) => entry.displayId === activeDisplay.id
      )
      active?.window.focus()
    } catch (error) {
      if (!this.overlays.size) return
      this.closeOverlays()
      this.notifyError(error)
    }
  }

  private closeOverlays(): void {
    for (const { window } of this.overlays.values()) {
      if (!window.isDestroyed()) window.destroy()
    }
    this.overlays.clear()
  }

  private readonly cancel = (event: IpcMainEvent): void => {
    if (this.overlays.has(event.sender.id)) this.closeOverlays()
  }

  private readonly complete = (event: IpcMainEvent, local: Rectangle): void => {
    const overlay = this.overlays.get(event.sender.id)
    if (!overlay || this.busy) return
    const display = screen.getAllDisplays().find((item) => item.id === overlay.displayId)
    if (!display || !local || ![local.x, local.y, local.width, local.height].every(Number.isFinite))
      return
    const windowBounds = overlay.window.getBounds()
    const left = Math.max(display.bounds.x, Math.floor(windowBounds.x + local.x))
    const top = Math.max(display.bounds.y, Math.floor(windowBounds.y + local.y))
    const right = Math.min(
      display.bounds.x + display.bounds.width,
      Math.ceil(windowBounds.x + local.x + local.width)
    )
    const bottom = Math.min(
      display.bounds.y + display.bounds.height,
      Math.ceil(windowBounds.y + local.y + local.height)
    )
    if (right - left < 5 || bottom - top < 5) return
    const region = { x: left, y: top, width: right - left, height: bottom - top }
    this.closeOverlays()
    this.busy = true
    void this.translateRegion(display.id, region).finally(() => {
      this.busy = false
    })
  }

  private async translateRegion(displayId: number, region: Rectangle): Promise<void> {
    try {
      // Let the window compositor remove the selection overlay before capturing.
      await new Promise((resolve) => setTimeout(resolve, 80))
      const image = await captureScreen({ displayId, region })
      try {
        this.showProgress(region)
      } catch (error) {
        console.warn('[ScreenshotTranslation] Failed to show OCR progress', error)
      }
      const observations =
        process.platform === 'darwin'
          ? (await recognizeMacText(image.data, ['zh-Hans', 'en-US', 'ja-JP', 'zh-Hant'], true))
              .observations
          : (await recognizeWindowsText(image.data)).observations
      const recognizedText = screenshotTranslationText(observations)
      const lexicon = this.runtime.builtInLexicon
      const text = (
        lexicon
          ? repairMergedEnglishWords(recognizedText, (word) => lexicon.lookup(word)?.frq ?? null)
          : recognizedText
      ).slice(0, TRANSLATION_MAX_TEXT_LENGTH)
      if (!text) throw new Error('选区内没有识别到文字。')
      this.translation.showSelection(text, {
        ...createCursorAnchor(),
        centerX: region.x + region.width / 2,
        top: region.y,
        bottom: region.y + region.height,
        gap: 8
      })
    } catch (error) {
      this.notifyError(error)
    } finally {
      if (this.progressWindow && !this.progressWindow.isDestroyed()) this.progressWindow.destroy()
      this.progressWindow = undefined
    }
  }

  private showProgress(region: Rectangle): void {
    const workArea = screen.getDisplayMatching(region).workArea
    const width = 190
    const height = 44
    const window = new BrowserWindow({
      x: Math.round(
        Math.max(
          workArea.x,
          Math.min(region.x + region.width / 2 - width / 2, workArea.x + workArea.width - width)
        )
      ),
      y: Math.round(
        Math.max(
          workArea.y,
          Math.min(region.y + region.height + 10, workArea.y + workArea.height - height)
        )
      ),
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.progressWindow = window
    window.setAlwaysOnTop(true, 'floating')
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
    }
    void window
      .loadURL(resolveRendererUrl('screenshot-progress.html'))
      .then(() => {
        if (!window.isDestroyed()) window.showInactive()
      })
      .catch((error) => {
        if (!window.isDestroyed())
          console.warn('[ScreenshotTranslation] Progress window failed', error)
      })
  }

  private notifyError(error: unknown): void {
    const message = error instanceof Error ? error.message : '截图翻译失败。'
    console.error('[ScreenshotTranslation]', message, error)
    const mainWindow = this.runtime.mainWindow
    if (mainWindow && !mainWindow.webContents.isDestroyed() && mainWindow.isVisible())
      mainWindow.webContents.send('notification:toast', { type: 'error', message })
    else new Notification({ title: '截图翻译', body: message }).show()
  }
}
