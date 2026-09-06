import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { DictionaryEntryGroup, DictionarySearchResult } from '../db-service'
import { BaseController } from './base-controller'

export class DictionaryEntryController extends BaseController {
  override mount(): void {
    ipcMain.handle('dictionary-entries:search', this.search)
    ipcMain.handle('dictionary-entries:lookup', this.lookup)
  }

  search = async (
    _event: IpcMainInvokeEvent,
    prefix: string,
    limit?: number
  ): Promise<DictionarySearchResult[]> => {
    return this.db.searchDictionaryEntries(prefix, limit)
  }

  lookup = async (
    _event: IpcMainInvokeEvent,
    term: string
  ): Promise<DictionaryEntryGroup | null> => {
    const startedAt = performance.now()
    try {
      const group = await this.db.lookupDictionaryEntryGroup(term)
      console.debug('[DictionaryLookup] main window', {
        term,
        takeMs: performance.now() - startedAt,
        matched: Boolean(group)
      })
      return group
    } catch (error) {
      console.debug('[DictionaryLookup] main window', {
        term,
        takeMs: performance.now() - startedAt,
        matched: false,
        failed: true
      })
      throw error
    }
  }
}
