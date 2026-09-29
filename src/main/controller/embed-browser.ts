import {
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents
} from 'electron'

import type { WebContentsViewManager } from '../web-contents-view-manager'
import { BaseController } from './base-controller'
import { dismissSearchPopover } from './search-popover'

type LoadRequest = { tabId: string; url: string; navigationVersion: number }

export class EmbedBrowserController extends BaseController {
  private activeTabId: string | null = null
  private readonly boundsByTabId = new Map<string, Rectangle>()
  private readonly navigationVersions = new Map<string, number>()
  private readonly configuredViews = new WeakSet<WebContents>()

  override mount(): void {
    ipcMain.handle('embed-browser:load', this.load)
    ipcMain.handle('embed-browser:close', this.close)
    ipcMain.on('embed-browser:activate', this.activate)
    ipcMain.on('embed-browser:set-bounds', this.setBounds)
  }

  load = async (event: IpcMainInvokeEvent, value: unknown): Promise<void> => {
    if (!this.acceptsHostSender(event.sender.id)) return
    const { tabId, url, navigationVersion } = validateLoadRequest(value)
    const view = this.getView(tabId)
    if (this.navigationVersions.get(tabId) === navigationVersion && view.getURL()) {
      if (this.activeTabId === tabId) this.showActiveView(tabId, view)
      return
    }

    this.navigationVersions.set(tabId, navigationVersion)
    if (this.activeTabId === tabId) this.showActiveView(tabId, view)

    try {
      await view.loadURL(url)
    } catch (error) {
      if (
        view.isDestroyed ||
        this.navigationVersions.get(tabId) !== navigationVersion ||
        isNavigationAborted(error)
      ) {
        return
      }
      throw error
    }
  }

  activate = (event: IpcMainEvent, value: unknown): void => {
    if (!this.acceptsHostSender(event.sender.id) || !isRecord(value)) return

    const rawTabId = value.tabId
    if (rawTabId === null) {
      this.activeTabId = null
      for (const view of this.runtime.windowManager.embedBrowserViews.values()) view.hide()
      return
    }

    const tabId = validateTabId(rawTabId)
    if (!tabId) return
    this.activeTabId = tabId
    if (isRectangle(value.bounds)) this.boundsByTabId.set(tabId, value.bounds)

    for (const [otherTabId, view] of this.runtime.windowManager.embedBrowserViews) {
      if (otherTabId !== tabId) view.hide()
    }
    const view = this.runtime.windowManager.embedBrowserViews.get(tabId)
    if (view) this.showActiveView(tabId, view)
  }

  setBounds = (event: IpcMainEvent, value: unknown): void => {
    if (!this.acceptsHostSender(event.sender.id) || !isRecord(value)) return
    const tabId = validateTabId(value.tabId)
    if (!tabId || !isRectangle(value.bounds)) return
    this.boundsByTabId.set(tabId, value.bounds)
    if (this.activeTabId !== tabId) return
    this.runtime.windowManager.embedBrowserViews.get(tabId)?.setBounds(value.bounds)
  }

  close = (event: IpcMainInvokeEvent, value: unknown): boolean => {
    if (!this.acceptsHostSender(event.sender.id)) return false
    const tabId = validateTabId(value)
    if (!tabId) return false
    if (this.activeTabId === tabId) this.activeTabId = null
    this.boundsByTabId.delete(tabId)
    this.navigationVersions.delete(tabId)
    return this.runtime.windowManager.closeEmbedBrowserView(tabId)
  }

  private getView(tabId: string): WebContentsViewManager {
    const view = this.runtime.windowManager.createEmbedBrowserView(tabId)
    if (this.configuredViews.has(view.webContents)) return view

    this.configuredViews.add(view.webContents)
    this.runtime.mainWindowShortcutRouter?.register(view.webContents, 'embed-browser', [
      'focus-search'
    ])
    this.runtime.adBlockService.attach(view.webContents.session)
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) {
        void shell.openExternal(url).catch((error: unknown) => {
          console.error('Failed to open external online dictionary URL', { url, error })
        })
      }
      return { action: 'deny' }
    })
    view.webContents.on('before-mouse-event', (_event, mouse) => {
      if (mouse.type !== 'mouseDown') return
      dismissSearchPopover(this.runtime)
    })
    view.webContents.on('did-navigate', () => this.notifyUrlChanged(tabId, view))
    view.webContents.on('did-navigate-in-page', () => this.notifyUrlChanged(tabId, view))
    view.webContents.on('did-start-loading', () =>
      view.sendToMainWindow('embed-browser:loading-changed', tabId, true)
    )
    view.webContents.on('did-stop-loading', () =>
      view.sendToMainWindow('embed-browser:loading-changed', tabId, false)
    )
    return view
  }

  private notifyUrlChanged(tabId: string, view: WebContentsViewManager): void {
    const url = view.getURL()
    if (url) view.sendToMainWindow('embed-browser:url-changed', tabId, url)
  }

  private showActiveView(tabId: string, view: WebContentsViewManager): void {
    if (view.isDestroyed) return
    const bounds = this.boundsByTabId.get(tabId)
    if (bounds) view.setBounds(bounds)
    view.show()
    view.bringToFront()
    const searchPopover = this.runtime.windowManager.searchPopoverView
    if (searchPopover?.isVisible) searchPopover.bringToFront()
  }

  private acceptsHostSender(senderId: number): boolean {
    const mainWindow = this.runtime.mainWindow
    return Boolean(
      mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === senderId
    )
  }
}

function validateLoadRequest(value: unknown): LoadRequest {
  if (!isRecord(value)) throw new Error('在线词典导航请求无效')
  const tabId = validateTabId(value.tabId)
  if (!tabId) throw new Error('在线词典标签页 ID 无效')
  if (
    typeof value.navigationVersion !== 'number' ||
    !Number.isSafeInteger(value.navigationVersion) ||
    value.navigationVersion < 0
  ) {
    throw new Error('在线词典导航版本无效')
  }
  return {
    tabId,
    url: validateUrl(value.url),
    navigationVersion: value.navigationVersion
  }
}

function validateTabId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined
}

function validateUrl(value: unknown): string {
  if (typeof value !== 'string' || !isHttpUrl(value)) {
    throw new Error('在线词典地址必须是 HTTP 或 HTTPS URL')
  }
  return value
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isNavigationAborted(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('ERR_ABORTED')) return true
  if (!error || typeof error !== 'object') return false
  const navigationError = error as { code?: unknown; errno?: unknown }
  return navigationError.code === 'ERR_ABORTED' || navigationError.errno === -3
}

function isRectangle(value: unknown): value is Rectangle {
  if (!isRecord(value)) return false
  return [value.x, value.y, value.width, value.height].every(
    (part) => typeof part === 'number' && Number.isFinite(part)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
