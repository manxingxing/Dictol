import {
  BrowserWindow,
  type Rectangle,
  type IgnoreMouseEventsOptions,
  type WebContents
} from 'electron'
import { EventEmitter } from 'node:events'
import {
  createSelectionPanel,
  destroySelectionPanel,
  getSelectionPanelBounds,
  hideSelectionPanel,
  selectionPanelState,
  setSelectionPanelBounds,
  showSelectionPanel,
  showSelectionPanelDisableMenu
} from '@dictol/mdict-native'

export type SelectionPanelId = 'toolbar'
type NativePanelEvent =
  | 'show'
  | 'hide'
  | 'resize'
  | 'resize-end'
  | 'move'
  | 'focus'
  | 'blur'
  | 'disable-selection'

const PANEL_IDS: Record<SelectionPanelId, number> = { toolbar: 0 }

/**
 * Presents a hidden Electron BrowserWindow's renderer tree in a genuine AppKit
 * non-activating NSPanel. The BrowserWindow remains the webContents owner; the
 * native panel is the only visible/top-level surface.
 */
export class NativeSelectionPanel extends EventEmitter {
  private destroyed = false

  constructor(
    readonly host: BrowserWindow,
    readonly panelId: SelectionPanelId,
    options: { resizable: boolean; movable: boolean }
  ) {
    super()
    createSelectionPanel(
      PANEL_IDS[panelId],
      host.getNativeWindowHandle(),
      options.resizable,
      options.movable,
      (event) => {
        if (!isNativePanelEvent(event)) return
        if (event === 'move' || event === 'resize-end') this.syncHostFrame()
        this.emit(event)
      }
    )
    // Chromium's WebContentsView still belongs to this hidden BrowserWindow.
    // Prevent focus requests routed through that owner from making Electron's
    // hidden NSWindow key; the reparented NSPanel remains independently keyable
    // and is the only native window that should receive user interaction.
    host.setFocusable(false)
    host.hide()
    host.once('closed', this.handleHostClosed)
  }

  readonly handleHostClosed = (): void => {
    if (this.destroyed) return
    this.destroyed = true
    try {
      destroySelectionPanel(PANEL_IDS[this.panelId])
    } catch (error) {
      console.error('Failed to destroy native selection panel after host closed', error)
    }
    this.emit('closed')
  }

  get id(): number {
    return this.host.id
  }

  get webContents(): WebContents {
    return this.host.webContents
  }

  isDestroyed(): boolean {
    return this.destroyed || this.host.isDestroyed()
  }

  isVisible(): boolean {
    return !this.isDestroyed() && (selectionPanelState(PANEL_IDS[this.panelId]) & 1) !== 0
  }

  isFocused(): boolean {
    return !this.isDestroyed() && (selectionPanelState(PANEL_IDS[this.panelId]) & 2) !== 0
  }

  getBounds(): Rectangle {
    return getSelectionPanelBounds(PANEL_IDS[this.panelId])
  }

  getSize(): [number, number] {
    const { width, height } = this.getBounds()
    return [width, height]
  }

  getContentSize(): [number, number] {
    return this.getSize()
  }

  setBounds(bounds: Rectangle, _animate?: boolean): void {
    void _animate
    if (this.isDestroyed()) return
    setSelectionPanelBounds(PANEL_IDS[this.panelId], bounds)
  }

  setSize(width: number, height: number, _animate?: boolean): void {
    void _animate
    const bounds = this.getBounds()
    this.setBounds({ ...bounds, width, height })
  }

  show(): void {
    if (!this.isDestroyed()) showSelectionPanel(PANEL_IDS[this.panelId], false)
  }

  showInactive(): void {
    this.show()
  }

  focus(): void {
    if (!this.isDestroyed()) showSelectionPanel(PANEL_IDS[this.panelId], true)
  }

  hide(): void {
    if (!this.isDestroyed()) hideSelectionPanel(PANEL_IDS[this.panelId])
  }

  showDisableSelectionMenu(enabled: boolean): void {
    if (!this.isDestroyed()) {
      showSelectionPanelDisableMenu(PANEL_IDS[this.panelId], enabled)
    }
  }

  setOpacity(opacity: number): void {
    if (!this.isDestroyed()) this.host.setOpacity(opacity)
  }

  setIgnoreMouseEvents(ignore: boolean, options?: IgnoreMouseEventsOptions): void {
    if (!this.isDestroyed()) this.host.setIgnoreMouseEvents(ignore, options)
  }

  loadURL(url: string): Promise<void> {
    return this.host.loadURL(url)
  }

  setBackgroundColor(color: string): void {
    if (!this.isDestroyed()) this.host.setBackgroundColor(color)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.host.removeListener('closed', this.handleHostClosed)
    destroySelectionPanel(PANEL_IDS[this.panelId])
    this.host.destroy()
    this.emit('closed')
    this.removeAllListeners()
  }

  private syncHostFrame(): void {
    if (this.isDestroyed()) return
    const bounds = getSelectionPanelBounds(PANEL_IDS[this.panelId])
    this.host.setBounds(bounds, false)
  }
}

function isNativePanelEvent(value: string): value is NativePanelEvent {
  return (
    value === 'show' ||
    value === 'hide' ||
    value === 'resize' ||
    value === 'resize-end' ||
    value === 'move' ||
    value === 'focus' ||
    value === 'blur' ||
    value === 'disable-selection'
  )
}
