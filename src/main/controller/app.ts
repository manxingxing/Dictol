import {
  app,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents
} from 'electron'

import type { DictionaryLayout } from '../../shared/dictionary-layout'
import type { DictionaryDisplay } from '../../shared/dictionary-display'
import { BaseController } from './base-controller'
import { DICTIONARY_SESSION_PARTITION, EMBED_BROWSER_SESSION_PARTITION } from '../entry-assets'

/**
 * 使用独立 Chromium 分区的 WebContentsView：查词释义视图（单栏与汇总两个布局
 * 共用同一个分区）和内置浏览器。这些分区与主窗口渲染进程相互隔离，
 * 缓存不会随主窗口刷新而释放。
 */
const VIEW_SESSION_PARTITIONS = [
  DICTIONARY_SESSION_PARTITION,
  EMBED_BROWSER_SESSION_PARTITION
] as const

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
    ipcMain.handle('app:get-dictionary-display', this.getDictionaryDisplay)
    ipcMain.handle('app:save-dictionary-display', this.saveDictionaryDisplay)
    ipcMain.handle('app:get-resource-cache-size', this.getResourceCacheSize)
    ipcMain.handle('app:clear-resource-cache', this.clearResourceCache)
    ipcMain.handle('app:open-resource-cache-directory', this.openResourceCacheDirectory)
    ipcMain.handle('app:get-view-cache-size', this.getViewCacheSize)
    ipcMain.handle('app:clear-view-cache', this.clearViewCache)
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

  getDictionaryDisplay = (event: IpcMainInvokeEvent): DictionaryDisplay | null => {
    if (!this.acceptsSender(event.sender)) return null
    return this.runtime.appConfig.load().dictionaryDisplay
  }

  saveDictionaryDisplay = (
    event: IpcMainInvokeEvent,
    display: unknown
  ): DictionaryDisplay | null => {
    if (!this.acceptsSender(event.sender)) return null
    if (display !== 'icon' && display !== 'name' && display !== 'icon-and-name') {
      throw new Error('词典显示设置无效。')
    }

    const current = this.runtime.appConfig.load()
    this.runtime.appConfig.save({ ...current, dictionaryDisplay: display })
    return display
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

  /** 各分区 HTTP 缓存占用的总字节数。 */
  getViewCacheSize = async (event: IpcMainInvokeEvent): Promise<number> => {
    if (!this.acceptsSender(event.sender)) return 0
    const sizes = await Promise.all(this.viewCacheSessions().map((it) => it.getCacheSize()))
    return sizes.reduce((total, size) => total + size, 0)
  }

  /**
   * 清空各分区的 HTTP 缓存与 V8 代码缓存。Cookie、localStorage 等站点数据
   * 不在清理范围内，登录状态不受影响。
   */
  clearViewCache = async (event: IpcMainInvokeEvent): Promise<void> => {
    if (!this.acceptsSender(event.sender)) return
    await Promise.all(
      this.viewCacheSessions().map(async (it) => {
        await Promise.all([it.clearCache(), it.clearCodeCaches({})])
      })
    )
  }

  private viewCacheSessions(): Session[] {
    return VIEW_SESSION_PARTITIONS.map((partition) => session.fromPartition(partition))
  }

  private acceptsSender(sender: WebContents): boolean {
    const window = this.runtime.mainWindow
    return Boolean(window && !window.isDestroyed() && window.webContents.id === sender.id)
  }
}
