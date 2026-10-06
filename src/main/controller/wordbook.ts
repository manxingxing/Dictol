import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'

import type {
  WordbookExportRequest,
  WordbookExportStatus,
  WordbookImportResult,
  WordbookSummary,
  WordbookWordItem,
  WordbookWordsPaginated
} from '../db-service'
import { BaseController } from './base-controller'

export class WordbookController extends BaseController {
  override mount(): void {
    ipcMain.handle('wordbooks:list', this.list)
    ipcMain.handle('wordbooks:create', this.create)
    ipcMain.handle('wordbooks:list-words', this.listWords)
    ipcMain.handle('wordbooks:add-word', this.addWord)
    ipcMain.handle('wordbooks:import-words', this.importWords)
    ipcMain.handle('wordbooks:toggle-star', this.toggleStar)
    ipcMain.handle('wordbooks:unstar-word', this.unStarWord)
    ipcMain.handle('wordbooks:is-starred', this.isStarred)
    ipcMain.handle('wordbooks:update-star', this.updateStar)
    ipcMain.handle('wordbooks:move-words', this.moveWords)
    ipcMain.handle('wordbooks:export', this.export)
    ipcMain.handle('wordbooks:export-status', this.getExportStatus)
    ipcMain.handle('wordbooks:select-directory', this.selectDirectory)
    ipcMain.handle('wordbooks:delete', this.deleteWordbook)
    ipcMain.handle('wordbooks:rename', this.renameWordbook)
    this.db.onWordbookExportStatus((status) => this.broadcastExportStatus(status))
  }

  list = async (): Promise<WordbookSummary[]> => {
    return await this.db.listWordbooks()
  }

  create = async (_event: IpcMainInvokeEvent, name: string): Promise<WordbookSummary> => {
    return await this.db.createWordbook(name)
  }

  listWords = async (
    _event: IpcMainInvokeEvent,
    wordbookId?: string,
    page = 1,
    pageSize = 25,
    tagId?: string | null,
    keyword?: string
  ): Promise<WordbookWordsPaginated> => {
    return await this.db.listWordbookWordsPaginated(wordbookId, page, pageSize, tagId, keyword)
  }

  addWord = async (
    _event: IpcMainInvokeEvent,
    word: string,
    star?: number
  ): Promise<WordbookWordItem> => {
    return await this.db.addWordToDefaultWordbook(word, star)
  }

  importWords = async (
    _event: IpcMainInvokeEvent,
    text: string,
    wordbookId?: string
  ): Promise<WordbookImportResult> => {
    return await this.db.importWordbookWords(text, wordbookId)
  }

  toggleStar = async (_event: IpcMainInvokeEvent, word: string): Promise<void> => {
    await this.db.toggleStarWord(word)
  }

  unStarWord = async (_event: IpcMainInvokeEvent, word: string): Promise<void> => {
    await this.db.unStarWord(word)
  }

  isStarred = async (_event: IpcMainInvokeEvent, word: string): Promise<boolean> => {
    return await this.db.isWordStarred(word)
  }

  updateStar = async (_event: IpcMainInvokeEvent, word: string, star: number): Promise<void> => {
    await this.db.updateWordStar(word, star)
  }

  moveWords = async (
    _event: IpcMainInvokeEvent,
    wordIds: string[],
    destinationWordbookId: string
  ): Promise<void> => {
    await this.db.moveWordbookWords(wordIds, destinationWordbookId)
  }

  getExportStatus = (): WordbookExportStatus => {
    return this.db.getWordbookExportStatus()
  }

  export = async (
    _event: IpcMainInvokeEvent,
    request: WordbookExportRequest,
    directoryPath: string
  ): Promise<{ started: boolean }> => {
    await this.db.startWordbookExport(request, directoryPath)
    return { started: true }
  }

  selectDirectory = async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      buttonLabel: '选择导出目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  }

  deleteWordbook = async (_event: IpcMainInvokeEvent, wordbookId: string): Promise<void> => {
    await this.db.deleteWordbook(wordbookId)
  }

  renameWordbook = async (
    _event: IpcMainInvokeEvent,
    wordbookId: string,
    name: string
  ): Promise<void> => {
    await this.db.renameWordbook(wordbookId, name)
  }

  private broadcastExportStatus(status: WordbookExportStatus): void {
    const mainWindow = this.runtime.mainWindow
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send('wordbooks:export-status-changed', status)

    if (status.state === 'completed' && status.destinationPath) {
      mainWindow.webContents.send('notification:toast', {
        type: 'success',
        message: `导出完成：${status.destinationPath}`
      })
    } else if (status.state === 'error' && status.error) {
      mainWindow.webContents.send('notification:toast', {
        type: 'error',
        message: `导出失败：${status.error}`
      })
    }
  }
}
