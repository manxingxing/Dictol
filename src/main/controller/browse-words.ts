import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import { BaseController } from './base-controller'

export class BrowseWordsController extends BaseController {
  override mount(): void {
    ipcMain.handle('browse:get-dictionary-name', this.getBrowseDictionaryName)
    ipcMain.handle('browse:list-entry-words', this.listBrowseEntryWords)
    ipcMain.handle('browse:prefix-entry-words', this.prefixBrowseEntryWords)
    ipcMain.handle('browse:lookup-in-main-window', this.lookupInMainWindow)
  }

  getBrowseDictionaryName = async (
    event: IpcMainInvokeEvent,
    dictionaryId: string
  ): Promise<string | null> => {
    this.requireBrowseWindow(event)
    const dictionary = await this.db.getDictionary(dictionaryId)
    return dictionary?.name ?? null
  }

  listBrowseEntryWords = async (
    event: IpcMainInvokeEvent,
    dictionaryId: string
  ): Promise<string[]> => {
    this.requireBrowseWindow(event)
    const numericId = await this.getReadyBrowseDictionaryId(event, dictionaryId)
    return this.runtime.mdictResourceManager.listEntryWords(numericId)
  }

  prefixBrowseEntryWords = async (
    event: IpcMainInvokeEvent,
    dictionaryId: string,
    prefix: string
  ): Promise<string[]> => {
    const numericId = await this.getReadyBrowseDictionaryId(event, dictionaryId)
    if (!prefix) return []
    return this.runtime.mdictResourceManager.prefixEntryWords(numericId, prefix)
  }

  lookupInMainWindow = async (
    event: IpcMainInvokeEvent,
    dictionaryId: string,
    term: string
  ): Promise<void> => {
    await this.getReadyBrowseDictionaryId(event, dictionaryId)
    const word = term.trim()
    if (!word) return

    this.runtime.activateMainWindow()

    let mainWindow = this.runtime.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

    const sendLookup = (): void => {
      if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('app:search-request', {
          term: word,
          source: 'browse',
          dictionaryId
        })
      }
    }
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', sendLookup)
    } else {
      sendLookup()
    }
  }

  private async getReadyBrowseDictionaryId(
    event: IpcMainInvokeEvent,
    dictionaryId: string
  ): Promise<number> {
    this.requireBrowseWindow(event)
    const numericId = Number(dictionaryId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new Error('无效的词典 ID')
    const dictionary = await this.db.getDictionary(dictionaryId)
    if (!dictionary || dictionary.status !== 'ready') throw new Error('词典尚未准备就绪')
    return numericId
  }

  // 来自浏览字典窗口
  private requireBrowseWindow(event: IpcMainInvokeEvent): void {
    const browseWindow = this.runtime.windowManager.browseWindow
    if (!browseWindow || browseWindow.webContents.id !== event.sender.id) {
      throw new Error('无效的浏览窗口')
    }
  }
}
