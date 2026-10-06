import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import type { WordbookTagItem, WordbookTagSummary } from '../db-service'
import { BaseController } from './base-controller'

export class WordbookTagController extends BaseController {
  override mount(): void {
    ipcMain.handle('wordbooks:list-tags', this.listTags)
    ipcMain.handle('wordbooks:create-tag', this.createTag)
    ipcMain.handle('wordbooks:rename-tag', this.renameTag)
    ipcMain.handle('wordbooks:delete-tag', this.deleteTag)
    ipcMain.handle('wordbooks:set-word-tags', this.setWordTags)
    ipcMain.handle('wordbooks:add-tag-to-words', this.addTagToWords)
    ipcMain.handle('wordbooks:remove-tag-from-words', this.removeTagFromWords)
  }

  listTags = async (): Promise<WordbookTagSummary[]> => await this.db.listWordbookTags()

  createTag = async (_event: IpcMainInvokeEvent, term: string): Promise<WordbookTagItem> =>
    await this.db.createWordbookTag(term)

  renameTag = async (_event: IpcMainInvokeEvent, tagId: string, term: string): Promise<void> =>
    await this.db.renameWordbookTag(tagId, term)

  deleteTag = async (_event: IpcMainInvokeEvent, tagId: string): Promise<void> =>
    await this.db.deleteWordbookTag(tagId)

  setWordTags = async (
    _event: IpcMainInvokeEvent,
    wordId: string,
    tagIds: string[]
  ): Promise<void> => await this.db.setWordbookWordTags(wordId, tagIds)

  addTagToWords = async (
    _event: IpcMainInvokeEvent,
    wordIds: string[],
    tagId: string
  ): Promise<void> => await this.db.addWordbookTagToWords(wordIds, tagId)

  removeTagFromWords = async (
    _event: IpcMainInvokeEvent,
    wordIds: string[],
    tagId: string
  ): Promise<void> => await this.db.removeWordbookTagFromWords(wordIds, tagId)
}
