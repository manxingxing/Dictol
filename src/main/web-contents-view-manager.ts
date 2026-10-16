import {
  BrowserWindow,
  WebContentsView,
  type Rectangle,
  type WebContents,
  type WebContentsViewConstructorOptions
} from 'electron'
import { EventEmitter } from 'node:events'

type WebContentsViewManagerEvents = {
  'hide-requested': []
  'visibility-changed': [visible: boolean]
}

export type WebContentsViewManagerOptions = {
  view?: WebContentsViewConstructorOptions
  backgroundColor?: string
  borderRadius?: number
}

export class WebContentsViewManager {
  readonly eventBus = new EventEmitter<WebContentsViewManagerEvents>()
  private readonly view: WebContentsView
  private visible = false
  private disposed = false

  constructor(
    private readonly mainWindow: BrowserWindow,
    options: WebContentsViewManagerOptions = {}
  ) {
    this.view = new WebContentsView(options.view)
    if (options.backgroundColor) this.view.setBackgroundColor(options.backgroundColor)
    if (options.borderRadius !== undefined) this.view.setBorderRadius(options.borderRadius)
    this.view.setVisible(false)
    this.mainWindow.contentView.addChildView(this.view)
  }

  get webContents(): WebContents {
    return this.view.webContents
  }

  get isVisible(): boolean {
    return this.visible
  }

  get isDestroyed(): boolean {
    return this.disposed || this.webContents?.isDestroyed() !== false
  }

  show(): boolean {
    if (this.isDestroyed || this.visible) return false
    this.view.setVisible(true)
    this.visible = true
    this.eventBus.emit('visibility-changed', true)
    return true
  }

  bringToFront(): void {
    if (this.isDestroyed || this.mainWindow.isDestroyed()) return
    // Re-adding an existing child view moves it to the top of its parent's
    // view stack without changing its bounds or visibility.
    this.mainWindow.contentView.addChildView(this.view)
  }

  hide(): boolean {
    this.eventBus.emit('hide-requested')
    if (this.isDestroyed || !this.visible) return false
    this.view.setVisible(false)
    this.visible = false
    this.eventBus.emit('visibility-changed', false)
    return true
  }

  setBounds(bounds: Rectangle): void {
    if (this.isDestroyed) return
    this.view.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    })
  }

  getBounds(): Rectangle {
    return this.view.getBounds()
  }

  setBackgroundColor(color: string): void {
    if (!this.isDestroyed) this.view.setBackgroundColor(color)
  }

  loadURL(url: string): Promise<void> {
    return this.webContents.loadURL(url)
  }

  loadFile(filePath: string): Promise<void> {
    return this.webContents.loadFile(filePath)
  }

  send(channel: string, ...args: unknown[]): void {
    if (!this.isDestroyed) this.webContents.send(channel, ...args)
  }

  sendToMainWindow(channel: string, ...args: unknown[]): void {
    if (this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) return
    this.mainWindow.webContents.send(channel, ...args)
  }

  focus(): void {
    if (!this.isDestroyed) this.webContents.focus()
  }

  reload(): void {
    if (!this.isDestroyed) this.webContents.reload()
  }

  getURL(): string {
    return this.isDestroyed ? '' : this.webContents.getURL()
  }

  acceptsSender(senderId: number): boolean {
    return !this.isDestroyed && this.webContents.id === senderId
  }

  acceptsHostSender(senderId: number): boolean {
    return !this.mainWindow.isDestroyed() && this.mainWindow.webContents.id === senderId
  }

  dispose(): void {
    if (this.disposed) return
    this.hide()
    this.disposed = true
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.contentView.removeChildView(this.view)
      }
    } catch {
      // mainWindow may be in a torn-down state during app quit
    }
    try {
      const wc = this.view?.webContents
      if (wc && !wc.isDestroyed()) wc.close()
    } catch {
      // webContents may already be destroyed
    }
    this.eventBus.removeAllListeners()
  }
}
