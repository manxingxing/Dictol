import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'

import trayIconPath from '../../resources/tray-icon.png?asset'

/** Keeps Dictol available after its main window has been hidden. */
export class TrayManager {
  private tray: Tray | undefined
  private mainWindow: BrowserWindow | undefined
  private createMainWindow: (() => BrowserWindow | undefined) | undefined

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    if (this.tray && !this.tray.isDestroyed()) return

    try {
      const size = process.platform === 'darwin' ? 18 : 20
      const icon = nativeImage.createFromPath(trayIconPath).resize({ width: size, height: size })
      if (icon.isEmpty()) throw new Error(`无法加载托盘图标：${trayIconPath}`)
      if (process.platform === 'darwin') icon.setTemplateImage(true)

      this.tray = new Tray(icon)
      this.tray.setToolTip('Dictol')
      const contextMenu = Menu.buildFromTemplate([
        { label: '显示 Dictol', click: this.showMainWindow },
        { type: 'separator' },
        { label: '退出 Dictol', click: () => app.quit() }
      ])
      this.tray.on('right-click', () => {
        this.tray?.popUpContextMenu(contextMenu);
      })
      this.tray.on('click', this.showMainWindow)
    } catch (error) {
      console.warn('Failed to create system tray', error)
    }
  }

  setMainWindowFactory(factory: () => BrowserWindow | undefined): void {
    this.createMainWindow = factory
  }

  dispose(): void {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy()
    this.tray = undefined
    this.mainWindow = undefined
    this.createMainWindow = undefined
  }

  private readonly showMainWindow = (): void => {
    const mainWindow = this.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return

    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  private getMainWindow(): BrowserWindow | undefined {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow

    const mainWindow = this.createMainWindow?.()
    if (mainWindow && !mainWindow.isDestroyed()) this.mainWindow = mainWindow
    return mainWindow
  }
}
