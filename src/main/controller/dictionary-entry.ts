import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  DictionaryEntryGroup,
  DictionarySearchGroup,
  DictionarySearchResult
} from '../db-service'
import type {
  DictionarySearchScopeChange,
  DictionarySearchScopeSource
} from '../../shared/dictionary-search-scope'
import { DictionaryIndexInitializationError } from '../dictionary-index-manager'
import { BaseController } from './base-controller'

export class DictionaryEntryController extends BaseController {
  override mount(): void {
    ipcMain.handle('dictionary-entries:search', this.search)
    ipcMain.handle('dictionary-entries:lookup', this.lookup)
    ipcMain.handle('dictionary-entries:list-groups', this.listGroups)
    ipcMain.handle('dictionary-search-scope:get', this.getSearchScope)
    ipcMain.handle('dictionary-search-scope:set', this.setSearchScope)
    this.runtime.dictionarySearchScope.subscribe(({ groupId, source }) => {
      const change: DictionarySearchScopeChange = {
        groupId: serializeGroupId(groupId),
        source
      }
      this.runtime.mainWindow?.webContents.send('dictionary-search-scope:changed', change)
      this.runtime.windowManager.searchPopoverView?.send('dictionary-search-scope:changed', change)
    })
  }

  search = async (
    _event: IpcMainInvokeEvent,
    prefix: string,
    limit?: number,
    groupId?: string | null
  ): Promise<DictionarySearchResult[]> => {
    return this.db.searchDictionaryEntries(prefix, limit, parseGroupId(groupId))
  }

  lookup = async (
    _event: IpcMainInvokeEvent,
    term: string,
    groupId?: string | null
  ): Promise<DictionaryEntryGroup | null> => {
    const startedAt = performance.now()
    try {
      const group = await this.db.lookupDictionaryEntryGroup(term, parseGroupId(groupId))
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
      if (error instanceof DictionaryIndexInitializationError) {
        this.runtime.mainWindow?.webContents.send('notification:toast', {
          type: 'error',
          message: error.message
        })
      }
      throw error
    }
  }

  listGroups = async (): Promise<DictionarySearchGroup[]> => this.db.listDictionarySearchGroups()

  getSearchScope = (event: IpcMainInvokeEvent): string | null => {
    if (!this.acceptsScopeSender(event.sender.id)) return null
    return serializeGroupId(this.runtime.dictionarySearchScope.get())
  }

  setSearchScope = (
    event: IpcMainInvokeEvent,
    groupId: string | null,
    source: DictionarySearchScopeSource
  ): string | null => {
    if (!this.acceptsScopeSender(event.sender.id)) return null
    if (groupId !== null && typeof groupId !== 'string') throw new Error('无效的词典组 ID')
    if (source !== 'search-panel' && source !== 'search-popover') {
      throw new Error('无效的词典组变更来源')
    }
    this.runtime.dictionarySearchScope.set(parseGroupId(groupId), source)
    return serializeGroupId(this.runtime.dictionarySearchScope.get())
  }

  private acceptsScopeSender(senderId: number): boolean {
    if (senderId === this.runtime.mainWindow?.webContents.id) return true
    return Boolean(this.runtime.windowManager.searchPopoverView?.acceptsSender(senderId))
  }
}

function serializeGroupId(groupId: number | undefined): string | null {
  return groupId === undefined ? null : String(groupId)
}

function parseGroupId(value: string | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!/^\d+$/.test(value)) throw new Error('无效的词典组 ID')
  const groupId = Number(value)
  if (!Number.isSafeInteger(groupId) || groupId <= 0) throw new Error('无效的词典组 ID')
  return groupId
}
