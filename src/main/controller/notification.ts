import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'

import { TOAST_TYPES, type ToastPayload } from '../../shared/notification'
import { BaseController } from './base-controller'

const MAX_TOAST_MESSAGE_LENGTH = 2_000

export class NotificationController extends BaseController {
  override mount(): void {
    ipcMain.on('notification:show-toast', this.showToast)
  }

  private readonly showToast = (event: IpcMainEvent, payload: unknown): void => {
    if (!this.acceptsNotificationSender(event.sender)) return

    const normalizedPayload = normalizeToastPayload(payload)
    const mainWindow = this.runtime.mainWindow
    if (!normalizedPayload || !mainWindow) return

    mainWindow.webContents.send('notification:toast', normalizedPayload)
  }

  private acceptsNotificationSender(sender: WebContents): boolean {
    const windowManager = this.runtime.windowManager
    const mainWindow = windowManager.mainWindow
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === sender.id) {
      return true
    }

    const views = [
      windowManager.dictionaryView,
      windowManager.aggregateDictionaryView,
      windowManager.embedBrowserView,
      windowManager.searchPopoverView,
      windowManager.selectionExplanationView,
      windowManager.findBarView
    ]
    if (views.some((view) => view?.acceptsSender(sender.id) === true)) return true

    const windows = [windowManager.selectionToolbarWindow, windowManager.selectionExplanationWindow]
    return windows.some(
      (window) =>
        window !== undefined && !window.isDestroyed() && window.webContents.id === sender.id
    )
  }
}

function normalizeToastPayload(value: unknown): ToastPayload | null {
  if (!value || typeof value !== 'object') return null

  const payload = value as Partial<ToastPayload>
  if (
    typeof payload.type !== 'string' ||
    !TOAST_TYPES.includes(payload.type as ToastPayload['type']) ||
    typeof payload.message !== 'string'
  ) {
    return null
  }

  const message = payload.message.trim()
  if (!message || message.length > MAX_TOAST_MESSAGE_LENGTH) return null

  return {
    type: payload.type as ToastPayload['type'],
    message
  }
}
