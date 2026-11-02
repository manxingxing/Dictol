import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents
} from 'electron'
import type {
  ScreenshotTranslationSettingResult,
  ScreenshotTranslationStatus
} from '../../shared/translation'
import { SCREENSHOT_TRANSLATION_SHORTCUT } from '../../shared/shortcuts'
import { OCR_SUPPORTED } from '../../shared/ocr'
import { BaseController } from './base-controller'

export class ScreenshotTranslationController extends BaseController {
  override mount(): void {
    ipcMain.handle('screenshot-translation:status', this.getStatus)
    ipcMain.handle('screenshot-translation:set-shortcut', this.setShortcut)
    ipcMain.on('screenshot-translation:complete', this.complete)
    ipcMain.on('screenshot-translation:cancel', this.cancel)
  }

  private acceptsSender(sender: WebContents): boolean {
    return sender.id === this.runtime.mainWindow?.webContents.id
  }

  private status(): ScreenshotTranslationStatus {
    const config = this.runtime.appConfig.load()
    return {
      supported: OCR_SUPPORTED,
      shortcut: config.shortcuts.screenshotTranslation,
      registered: this.runtime.shortcutRegister.isRegistered(SCREENSHOT_TRANSLATION_SHORTCUT)
    }
  }

  private readonly getStatus = (event: IpcMainInvokeEvent): ScreenshotTranslationStatus | null =>
    this.acceptsSender(event.sender) ? this.status() : null

  private readonly setShortcut = (
    event: IpcMainInvokeEvent,
    shortcut: unknown
  ): ScreenshotTranslationSettingResult | null => {
    if (!this.acceptsSender(event.sender)) return null
    if (!OCR_SUPPORTED || typeof shortcut !== 'string' || shortcut.length > 64)
      return { ok: false, status: this.status(), error: '无效的截图翻译快捷键。' }
    const normalized = shortcut.trim()
    const previous = this.runtime.appConfig.load()
    if (
      normalized === previous.shortcuts.screenshotTranslation &&
      (!normalized || this.runtime.shortcutRegister.isRegistered(SCREENSHOT_TRANSLATION_SHORTCUT))
    ) {
      return { ok: true, status: this.status() }
    }
    this.runtime.appConfig.save({
      ...previous,
      shortcuts: { ...previous.shortcuts, screenshotTranslation: normalized }
    })
    this.runtime.restartScreenshotTranslationShortcut()
    if (
      normalized &&
      !this.runtime.shortcutRegister.isRegistered(SCREENSHOT_TRANSLATION_SHORTCUT)
    ) {
      this.runtime.appConfig.save(previous)
      this.runtime.restartScreenshotTranslationShortcut()
      return { ok: false, status: this.status(), error: '这个快捷键无效或已被占用。' }
    }
    if (!normalized) this.runtime.actions.screenshotTranslation.closeOverlays()
    return { ok: true, status: this.status() }
  }

  private readonly cancel = (event: IpcMainEvent): void => {
    if (!this.runtime.actions.screenshotTranslation.isOverlaySender(event.sender.id)) return
    this.runtime.actions.screenshotTranslation.cancelSelection()
  }

  private readonly complete = (event: IpcMainEvent, local: Rectangle): void => {
    if (!this.runtime.actions.screenshotTranslation.isOverlaySender(event.sender.id)) return
    this.runtime.actions.screenshotTranslation.completeSelection(event.sender.id, local)
  }
}
