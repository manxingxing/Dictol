import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'

import trayIconPath from '../../resources/tray-icon.png?asset'
import type { AppRuntime } from './app-runtime'
import { OCR_SUPPORTED } from '../shared/ocr'

/** Keeps Dictol available after its main window has been hidden. */
export class TrayManager {
  private tray: Tray | undefined

  constructor(private readonly runtime: AppRuntime) {}

  initialize(): void {
    if (this.tray && !this.tray.isDestroyed()) return

    try {
      const size = process.platform === 'darwin' ? 18 : 20
      const icon = nativeImage.createFromPath(trayIconPath).resize({ width: size, height: size })
      if (icon.isEmpty()) throw new Error(`无法加载托盘图标：${trayIconPath}`)
      if (process.platform === 'darwin') icon.setTemplateImage(true)

      this.tray = new Tray(icon)
      this.tray.setToolTip('Dictol')
      const showContextMenu = (): void => this.tray?.popUpContextMenu(this.buildContextMenu())
      this.tray.on('click', showContextMenu)
      this.tray.on('right-click', showContextMenu)
    } catch (error) {
      console.warn('Failed to create system tray', error)
    }
  }

  dispose(): void {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy()
    this.tray = undefined
  }

  private buildContextMenu(): Menu {
    const items: MenuItemConstructorOptions[] = [
      { label: '显示 Dictol', click: this.showMainWindow },
      { type: 'separator' }
    ]
    if (OCR_SUPPORTED) {
      const shortcut = this.runtime.appConfig.load().shortcuts.screenshotTranslation
      items.push({
        label: '截图翻译',
        accelerator: shortcut || undefined,
        registerAccelerator: false,
        click: () => void this.runtime.actions.screenshotTranslation.toggleSelector()
      })
    }
    const clipboardShortcut = this.runtime.appConfig.load().shortcuts.clipboardTranslation
    items.push({
      label: '翻译剪贴板内容',
      accelerator: clipboardShortcut || undefined,
      registerAccelerator: false,
      click: () => void this.runtime.actions.clipboardTranslation.translateFromClipboard()
    })
    items.push({ type: 'separator' })
    items.push({ label: '退出 Dictol', click: () => app.quit() })
    return Menu.buildFromTemplate(items)
  }

  private readonly showMainWindow = (): void => {
    const mainWindow = this.runtime.getOrCreateMainWindow()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}
