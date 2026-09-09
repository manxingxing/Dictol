import { ipcMain, type IpcMainEvent, type Rectangle } from 'electron'
import type { AppRuntime } from '../app-runtime'
import type { WebContentsViewManager } from '../web-contents-view-manager'
import { resolveRendererUrl } from '../output-path'
import { BaseController } from './base-controller'

export type SearchPopoverItem = {
  word: string
  description: string
  recent: boolean
}

export type SearchPopoverPayload = {
  query: string
  items: SearchPopoverItem[]
  selectedIndex: number
  status?: 'loading' | 'empty'
}

export function dismissSearchPopover(runtime: AppRuntime): void {
  const popover = runtime.windowManager.searchPopoverView
  if (!popover?.isVisible) return
  popover.hide()
  runtime.windowManager.focusMainWindowRenderer()
  popover.sendToMainWindow('search-popover:dismissed')
}

export class SearchPopoverController extends BaseController {
  private initialized = false
  private popoverWebContentsId: number | undefined
  private loaded = false
  private pendingPayload: SearchPopoverPayload | undefined
  private showRequested = false
  private receivedDataSinceShow = false
  private focusRequested = false

  override mount(): void {
    ipcMain.on('search-popover:show', this.show)
    ipcMain.on('search-popover:hide', this.hide)
    ipcMain.on('search-popover:set-bounds', this.setBounds)
    ipcMain.on('search-popover:update', this.update)
    ipcMain.on('search-popover:select', this.select)
    ipcMain.on('search-popover:query-change', this.queryChange)
    ipcMain.on('search-popover:submit', this.submit)
    ipcMain.on('search-popover:dismiss', this.dismiss)
  }

  show = (event: IpcMainEvent): void => {
    if (!this.acceptsHostSender(event.sender.id)) return
    const popover = this.initializeView()
    popover.bringToFront()
    if (this.showRequested) {
      if (popover.isVisible) this.handleVisibilityChanged(true)
      return
    }
    this.showRequested = true
    this.receivedDataSinceShow = false
    this.focusRequested = true
    if (popover.isVisible) this.handleVisibilityChanged(true)
  }

  hide = (event: IpcMainEvent): void => {
    if (!this.acceptsHostSender(event.sender.id)) return
    const popover = this.currentPopover
    if (!popover?.isVisible) return
    popover.hide()
    this.runtime.windowManager.focusMainWindowRenderer()
  }

  setBounds = (event: IpcMainEvent, bounds: Rectangle): void => {
    if (!this.acceptsHostSender(event.sender.id) || !isRectangle(bounds)) return
    this.currentPopover?.setBounds(bounds)
  }

  update = (event: IpcMainEvent, payload: SearchPopoverPayload): void => {
    if (!this.acceptsHostSender(event.sender.id) || !isSearchPopoverPayload(payload)) return
    if (!this.currentPopover) return
    this.pendingPayload = payload
    this.receivedDataSinceShow = true
    this.flushPendingPayload()
    this.updateVisibility()
  }

  select = (event: IpcMainEvent, word: string): void => {
    if (!this.currentPopover?.acceptsSender(event.sender.id) || typeof word !== 'string') return
    this.sendTextToHost('search-popover:selected', word.trim(), false)
  }

  queryChange = (event: IpcMainEvent, query: string): void => {
    if (!this.currentPopover?.acceptsSender(event.sender.id) || typeof query !== 'string') return
    this.sendTextToHost('search-popover:query-changed', query, true)
  }

  submit = (event: IpcMainEvent, query: string): void => {
    if (!this.currentPopover?.acceptsSender(event.sender.id) || typeof query !== 'string') return
    this.sendTextToHost('search-popover:submitted', query.trim(), false)
  }

  dismiss = (event: IpcMainEvent): void => {
    const popover = this.currentPopover
    if (!popover?.acceptsSender(event.sender.id)) return
    dismissSearchPopover(this.runtime)
  }

  private initializeView(): WebContentsViewManager {
    const popover = this.runtime.windowManager.createSearchPopoverView()
    this.runtime.mainWindowShortcutRouter?.register(popover.webContents, 'search-popover')
    if (this.initialized && this.popoverWebContentsId === popover.webContents.id) return popover

    this.initialized = true
    this.popoverWebContentsId = popover.webContents.id
    this.loaded = false
    this.showRequested = false
    this.receivedDataSinceShow = false
    this.focusRequested = false
    popover.eventBus.on('hide-requested', this.handleHideRequested)
    popover.eventBus.on('visibility-changed', this.handleVisibilityChanged)
    popover.webContents.on('did-finish-load', () => {
      this.loaded = true
      this.flushPendingPayload()
      this.updateVisibility()
    })
    popover.webContents.on('will-navigate', (event) => event.preventDefault())

    const loadPromise = popover.loadURL(resolveRendererUrl('search-popover.html'))

    void loadPromise.catch((error: unknown) => {
      console.error('Failed to load compact search popover', error)
    })
    return popover
  }

  private flushPendingPayload(): void {
    const popover = this.currentPopover
    if (!popover || !this.loaded || !this.pendingPayload) return
    popover.send('search-popover:update', this.pendingPayload)
  }

  private updateVisibility(): void {
    const popover = this.currentPopover
    if (!popover) return
    const shouldShow = this.loaded && this.showRequested && this.receivedDataSinceShow
    if (!shouldShow) return

    popover.show()
    popover.bringToFront()
    if (!this.focusRequested) return
    this.focusRequested = false
    popover.focus()
    popover.send('search-popover:focus-input')
  }

  private sendTextToHost(channel: string, value: string, allowEmpty: boolean): void {
    if ((!allowEmpty && !value) || value.length > 200) return
    this.currentPopover?.sendToMainWindow(channel, value)
  }

  private readonly handleHideRequested = (): void => {
    this.showRequested = false
    this.receivedDataSinceShow = false
    this.currentPopover?.sendToMainWindow('search-popover:hidden')
  }

  private readonly handleVisibilityChanged = (visible: boolean): void => {
    if (visible) this.currentPopover?.sendToMainWindow('search-popover:shown')
  }

  private acceptsHostSender(senderId: number): boolean {
    const mainWindow = this.runtime.mainWindow
    return Boolean(
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed() &&
      mainWindow.webContents.id === senderId
    )
  }

  private get currentPopover(): WebContentsViewManager | undefined {
    const popover = this.runtime.windowManager.searchPopoverView
    return popover && !popover.isDestroyed ? popover : undefined
  }
}

function isRectangle(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false
  const rectangle = value as Partial<Rectangle>
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(
    (part) => typeof part === 'number' && Number.isFinite(part) && part >= 0
  )
}

function isSearchPopoverPayload(value: unknown): value is SearchPopoverPayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as {
    query?: unknown
    items?: unknown
    selectedIndex?: unknown
    status?: unknown
  }
  if (
    typeof payload.query !== 'string' ||
    payload.query.length > 200 ||
    !Array.isArray(payload.items) ||
    payload.items.length > 10 ||
    typeof payload.selectedIndex !== 'number' ||
    !Number.isInteger(payload.selectedIndex) ||
    (payload.items.length === 0
      ? payload.selectedIndex !== -1
      : payload.selectedIndex < 0 || payload.selectedIndex >= payload.items.length) ||
    (payload.status !== undefined && payload.status !== 'loading' && payload.status !== 'empty') ||
    (payload.items.length > 0 && payload.status !== undefined)
  ) {
    return false
  }
  return payload.items.every((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false
    const candidate = item as Partial<SearchPopoverItem>
    return (
      typeof candidate.word === 'string' &&
      candidate.word.length > 0 &&
      candidate.word.length <= 200 &&
      typeof candidate.description === 'string' &&
      candidate.description.length <= 100 &&
      typeof candidate.recent === 'boolean'
    )
  })
}
