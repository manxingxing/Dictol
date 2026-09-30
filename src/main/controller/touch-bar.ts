import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'

import type { TouchBarState } from '../../shared/touch-bar'
import { TouchBarManager } from '../touch-bar-manager'
import { BaseController } from './base-controller'

export class TouchBarController extends BaseController {
  private readonly touchBar = new TouchBarManager(
    () => this.runtime.mainWindow,
    (dictionaryId) => this.db.getDictionaryIconPathById(dictionaryId),
    () => {
      this.runtime.activateMainWindow()
      this.runtime.mainWindow?.webContents.send('app:focus-search')
    },
    () => this.runtime.mainWindow?.webContents.send('app:touchbar-toggle-star'),
    (dictionaryId) =>
      this.runtime.mainWindow?.webContents.send('app:touchbar-select-dictionary', dictionaryId)
  )

  override mount(): void {
    ipcMain.on('app:touchbar-page', this.setPage)
    ipcMain.on('app:touchbar-state', this.updateState)
  }

  private setPage = (event: IpcMainEvent, page: unknown): void => {
    if (!this.acceptsSender(event.sender)) return
    if (page !== 'search' && page !== null) return
    this.touchBar.setSearchPageVisible(page === 'search')
  }

  private updateState = (event: IpcMainEvent, value: unknown): void => {
    if (!this.acceptsSender(event.sender)) return
    const state = parseTouchBarState(value)
    if (!state) return
    this.touchBar.updateState(state)
  }

  private acceptsSender(sender: WebContents): boolean {
    const window = this.runtime.mainWindow
    return Boolean(window && !window.isDestroyed() && window.webContents.id === sender.id)
  }
}

function parseTouchBarState(value: unknown): TouchBarState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const word = candidate.word
  const starred = candidate.starred
  const dictionaries = candidate.dictionaries

  if (
    (word !== null && (typeof word !== 'string' || word.trim().length > 200)) ||
    typeof starred !== 'boolean' ||
    !Array.isArray(dictionaries)
  ) {
    return null
  }

  const parsedDictionaries: TouchBarState['dictionaries'] = []
  const seenIds = new Set<string>()
  for (const dictionary of dictionaries) {
    if (!dictionary || typeof dictionary !== 'object') return null
    const candidateDictionary = dictionary as Record<string, unknown>
    const dictionaryId = candidateDictionary.dictionaryId
    const dictionaryName = candidateDictionary.dictionaryName
    if (
      typeof dictionaryId !== 'string' ||
      !dictionaryId.trim() ||
      typeof dictionaryName !== 'string' ||
      !dictionaryName.trim() ||
      dictionaryName.length > 200
    ) {
      return null
    }
    if (seenIds.has(dictionaryId)) continue
    seenIds.add(dictionaryId)
    parsedDictionaries.push({ dictionaryId, dictionaryName })
  }

  return {
    word: typeof word === 'string' ? word.trim() || null : null,
    starred,
    dictionaries: parsedDictionaries
  }
}
