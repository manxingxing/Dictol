import { contextBridge, ipcRenderer } from 'electron'
import type { SearchPopoverPayload } from '../shared/search-popover'
import type {
  DictionarySearchScopeChange,
  DictionarySearchScopeSource
} from '../shared/dictionary-search-scope'

type SearchPopoverSubscriber = (payload: SearchPopoverPayload) => void

let latestPayload: SearchPopoverPayload | undefined
let focusRequested = false
const subscribers = new Set<SearchPopoverSubscriber>()

ipcRenderer.on('search-popover:update', (_event, payload: SearchPopoverPayload): void => {
  latestPayload = payload
  subscribers.forEach((subscriber) => subscriber(payload))
})

ipcRenderer.on('search-popover:focus-input', (): void => {
  focusRequested = true
})

const scopeSubscribers = new Set<(change: DictionarySearchScopeChange) => void>()
ipcRenderer.on(
  'dictionary-search-scope:changed',
  (_event, change: DictionarySearchScopeChange): void => {
    scopeSubscribers.forEach((subscriber) => subscriber(change))
  }
)

const api = Object.freeze({
  onUpdate: (callback: SearchPopoverSubscriber): (() => void) => {
    subscribers.add(callback)
    if (latestPayload) callback(latestPayload)
    return () => subscribers.delete(callback)
  },
  onFocus: (callback: () => void): (() => void) => {
    const listener = (): void => {
      focusRequested = false
      callback()
    }
    ipcRenderer.on('search-popover:focus-input', listener)
    if (focusRequested) listener()
    return () => ipcRenderer.removeListener('search-popover:focus-input', listener)
  },
  changeQuery: (query: string): void => ipcRenderer.send('search-popover:query-change', query),
  select: (word: string): void => ipcRenderer.send('search-popover:select', word),
  submit: (query: string): void => ipcRenderer.send('search-popover:submit', query),
  dictionarySearchScope: Object.freeze({
    get: (): Promise<string | null> => ipcRenderer.invoke('dictionary-search-scope:get'),
    set: (groupId: string | null, source: DictionarySearchScopeSource): Promise<string | null> =>
      ipcRenderer.invoke('dictionary-search-scope:set', groupId, source),
    onChanged: (callback: (change: DictionarySearchScopeChange) => void): (() => void) => {
      scopeSubscribers.add(callback)
      return () => scopeSubscribers.delete(callback)
    }
  }),
  setScopeMenuOpen: (open: boolean): void =>
    ipcRenderer.send('search-popover:scope-menu-open', open),
  dismiss: (): void => ipcRenderer.send('search-popover:dismiss')
})

contextBridge.exposeInMainWorld('dictolSearchPopover', api)
