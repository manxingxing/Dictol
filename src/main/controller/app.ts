import { app, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'

import { BaseController } from './base-controller'

export class AppController extends BaseController {
  override mount(): void {
    // Keep app metadata behind the same sender boundary as the other renderer APIs.
    ipcMain.handle('app:get-version', this.getVersion)
    ipcMain.handle('app:get-resource-cache-size', this.getResourceCacheSize)
    ipcMain.handle('app:clear-resource-cache', this.clearResourceCache)
    ipcMain.handle('app:open-resource-cache-directory', this.openResourceCacheDirectory)
  }

  getVersion = (event: IpcMainInvokeEvent): string | null => {
    if (!this.acceptsSender(event.sender)) return null
    return app.getVersion()
  }

  getResourceCacheSize = async (event: IpcMainInvokeEvent): Promise<number> => {
    if (!this.acceptsSender(event.sender)) return 0
    return this.runtime.resourceCache.getSize()
  }

  clearResourceCache = async (event: IpcMainInvokeEvent): Promise<void> => {
    if (!this.acceptsSender(event.sender)) return
    await this.runtime.resourceCache.clear()
  }

  openResourceCacheDirectory = async (event: IpcMainInvokeEvent): Promise<void> => {
    if (!this.acceptsSender(event.sender)) return
    const directory = await this.runtime.resourceCache.ensureDirectory()
    const error = await shell.openPath(directory)
    if (error) throw new Error(error)
  }

  private acceptsSender(sender: WebContents): boolean {
    const window = this.runtime.mainWindow
    return Boolean(window && !window.isDestroyed() && window.webContents.id === sender.id)
  }
}
