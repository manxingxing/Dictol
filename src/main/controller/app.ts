import { app, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'

import type { DictionaryLayout } from '../../shared/dictionary-layout'
import { BaseController } from './base-controller'

export class AppController extends BaseController {
  override mount(): void {
    // Keep app metadata behind the same sender boundary as the other renderer APIs.
    ipcMain.handle('app:get-version', this.getVersion)
    ipcMain.handle('app:get-aggregate-layout', (event) => {
      if (!this.acceptsSender(event.sender)) return null
      return this.runtime.appConfig.load().aggregateLayout
    })
    ipcMain.handle('app:save-aggregate-layout', (event, layout: unknown) => {
      if (!this.acceptsSender(event.sender)) return null
      if (layout !== 'horizontal' && layout !== 'vertical') throw new Error('无效的汇总布局')
      this.runtime.appConfig.save({ ...this.runtime.appConfig.load(), aggregateLayout: layout })
      if (this.runtime.dictionaryLayout === 'aggregate') {
        this.runtime.activeDictionaryView?.send('dictionary-view:layout-changed', layout)
      }
      return layout
    })
    ipcMain.handle('app:get-dictionary-layout', this.getDictionaryLayout)
    ipcMain.handle('app:get-running-dictionary-layout', (event) => {
      if (!this.acceptsSender(event.sender)) return null
      return this.runtime.dictionaryLayout
    })
    ipcMain.handle('app:save-dictionary-layout', this.saveDictionaryLayout)
    ipcMain.handle('app:get-resource-cache-size', this.getResourceCacheSize)
    ipcMain.handle('app:clear-resource-cache', this.clearResourceCache)
    ipcMain.handle('app:open-resource-cache-directory', this.openResourceCacheDirectory)
  }

  getVersion = (event: IpcMainInvokeEvent): string | null => {
    if (!this.acceptsSender(event.sender)) return null
    return app.getVersion()
  }

  getDictionaryLayout = (event: IpcMainInvokeEvent): DictionaryLayout | null => {
    if (!this.acceptsSender(event.sender)) return null
    return this.runtime.appConfig.load().dictionaryLayout
  }

  saveDictionaryLayout = (event: IpcMainInvokeEvent, layout: unknown): DictionaryLayout | null => {
    if (!this.acceptsSender(event.sender)) return null
    if (layout !== 'single' && layout !== 'aggregate') {
      throw new Error('词典页面布局设置无效。')
    }

    const current = this.runtime.appConfig.load()
    this.runtime.appConfig.save({ ...current, dictionaryLayout: layout })
    return layout
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
