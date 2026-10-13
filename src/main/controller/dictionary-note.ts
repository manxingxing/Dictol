import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import type {
  CreateDictionaryNoteRequest,
  DictionaryNoteItem,
  DictionaryNoteSearchResult,
  DictionaryNoteWordGroupSearchResult,
  UpdateDictionaryNoteContentRequest
} from '../../shared/dictionary-note'
import {
  createDictionaryNoteWithImages,
  deleteDictionaryNoteImage
} from '../service/dictionary-note-image'
import { BaseController } from './base-controller'

export class DictionaryNoteController extends BaseController {
  override mount(): void {
    ipcMain.handle('dictionary-notes:list-by-term', this.listByTerm)
    ipcMain.handle('dictionary-notes:count-by-term', this.countByTerm)
    ipcMain.handle('dictionary-notes:search', this.search)
    ipcMain.handle('dictionary-notes:search-by-word', this.searchByWord)
    ipcMain.handle('dictionary-notes:create', this.create)
    ipcMain.handle('dictionary-notes:update-content', this.updateContent)
    ipcMain.handle('dictionary-notes:delete', this.delete)
  }

  listByTerm = async (_event: IpcMainInvokeEvent, term: string): Promise<DictionaryNoteItem[]> => {
    return await this.db.listNotesByTerm(term)
  }

  countByTerm = async (_event: IpcMainInvokeEvent, term: string): Promise<number> => {
    return await this.db.countNotesByTerm(term)
  }

  search = async (
    _event: IpcMainInvokeEvent,
    query: string,
    page: number,
    pageSize: number
  ): Promise<DictionaryNoteSearchResult> => {
    return await this.db.searchDictionaryNotes(query, page, pageSize)
  }

  searchByWord = async (
    _event: IpcMainInvokeEvent,
    query: string,
    page: number,
    pageSize: number
  ): Promise<DictionaryNoteWordGroupSearchResult> => {
    return await this.db.searchDictionaryNotesByWord(query, page, pageSize)
  }

  create = async (
    _event: IpcMainInvokeEvent,
    input: CreateDictionaryNoteRequest
  ): Promise<DictionaryNoteItem> => {
    const { imageBytes = [], ...noteInput } = input
    return await createDictionaryNoteWithImages(this.db, { ...noteInput, imageBytes })
  }

  updateContent = async (
    _event: IpcMainInvokeEvent,
    noteId: string,
    content: UpdateDictionaryNoteContentRequest
  ): Promise<void> => {
    await this.db.updateDictionaryNoteContent(noteId, content)
  }

  delete = async (_event: IpcMainInvokeEvent, noteId: string): Promise<void> => {
    const storageKeys = await this.db.listDictionaryNoteImageStorageKeys(noteId)
    await this.db.deleteDictionaryNote(noteId)
    const deletions = await Promise.allSettled(
      storageKeys.map((storageKey) => deleteDictionaryNoteImage(storageKey))
    )
    deletions.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Failed to remove deleted dictionary note image', result.reason)
      }
    })
  }
}
