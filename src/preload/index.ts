import { contextBridge, ipcRenderer } from 'electron'

import type {
  AiChatRequest,
  AiLookupPublicConfig,
  AiSaveConfigRequest,
  AiStreamEvent
} from '../shared/ai-ipc'
import type { DictionaryImportPreview, DictionaryImportRequest } from '../shared/dictionary-import'
import type { DictionaryInfo } from '../shared/dictionary-info'
import type { DeepLinkIntent } from '../shared/deep-link'
import type { ToastPayload } from '../shared/notification'
import type { TtsConfig, TtsSaveConfigRequest } from '../shared/tts'

type ReadyDictionary = {
  id: string
  name: string
  description: string | null
  recordCount: string | null
  status: 'ready'
  createdAt: string
  updatedAt: string
}

type DictionarySummary = Omit<ReadyDictionary, 'status'> & {
  status: 'pending' | 'importing' | 'ready' | 'error'
  customCss: string
  external: boolean
}

type ImportedDictionary = {
  id: string
  name: string
  status: 'importing'
  directory: string
  files: Array<{
    id: string
    name: string
    type: 'mdx' | 'mdd'
  }>
}

type OnlineDictionaryConfig = {
  id: string
  name: string
  faviconUrl: string
  urlTemplate: string
}

type DictionaryMatch = {
  entryId: string
  dictionaryId: string
  dictionaryName: string
  dictionaryIconUrl: string | null
}

type DictionaryEntryGroup = {
  word: string
  normalizedWord: string
  dictionaries: DictionaryMatch[]
}

type DictionarySearchResult = {
  word: string
  normalizedWord: string
  dictionaryCount: number
}

type QueryHistoryItem = {
  id: string
  term: string
  queryCount: number
  lastQueriedAt: string
}

type WordbookSummary = {
  id: string
  name: string
  isDefault: boolean
  wordCount: number
  createdAt: string
  updatedAt: string
}

type WordbookWordItem = {
  id: string
  wordbookId: string
  wordbookName: string
  word: string
  star: number
  dictionaryWord: string | null
  phonetic: string | null
  definition: string | null
  translation: string | null
  ecdictVersion: string | null
  createdAt: string
  updatedAt: string
}

type WordbookExportRequest =
  | { scope: 'all' }
  | { scope: 'wordbook'; wordbookId: string }
  | { scope: 'selected'; wordIds: string[] }

type WordbookExportStatus = {
  state: 'idle' | 'exporting' | 'completed' | 'error'
  destinationPath: string | null
  error: string | null
}

type WordbookImportResult = {
  imported: number
  matched: number
  unmatched: number
  wordbookId: string
  wordbookName: string
}

type WordCaptureStatus = {
  supported: boolean
  limitation: string | null
  trusted: boolean
  registered: boolean
  shortcut: string
  lookupWordOnSelection: boolean
  excludedPrograms: string[]
}

type WordCaptureEvent =
  | { type: 'lookup'; text: string }
  | { type: 'permission-required' }
  | { type: 'empty' }
  | { type: 'error'; message: string }

type WordCaptureShortcutResult = {
  ok: boolean
  status: WordCaptureStatus
  error?: string
}

type OpenInputMonitoringSettingsResult = {
  ok: boolean
  error?: string
}

type SearchPopoverItem = {
  word: string
  description: string
  recent: boolean
}

type AiStreamEventPayload = AiStreamEvent & { requestId: string }

type WordCaptureSubscriber = (event: WordCaptureEvent) => void

const wordCaptureSubscribers = new Set<WordCaptureSubscriber>()
let pendingWordCaptureEvent: WordCaptureEvent | undefined
const deepLinkSubscribers = new Set<(intent: DeepLinkIntent) => void>()
const pendingDeepLinks: DeepLinkIntent[] = []

ipcRenderer.on('word-capture:event', (_event, captureEvent: WordCaptureEvent) => {
  if (wordCaptureSubscribers.size === 0) {
    pendingWordCaptureEvent = captureEvent
    return
  }
  wordCaptureSubscribers.forEach((subscriber) => subscriber(captureEvent))
})

ipcRenderer.on('app:deep-link', (_event, intent: DeepLinkIntent) => {
  if (deepLinkSubscribers.size === 0) {
    pendingDeepLinks.push(intent)
    return
  }
  deepLinkSubscribers.forEach((subscriber) => subscriber(intent))
})

const api = Object.freeze({
  platform: process.platform,
  dictionaries: Object.freeze({
    list: (): Promise<DictionarySummary[]> => ipcRenderer.invoke('dictionaries:list'),
    listReady: (): Promise<ReadyDictionary[]> => ipcRenderer.invoke('dictionaries:list-ready'),
    selectFile: (): Promise<DictionaryImportPreview | null> =>
      ipcRenderer.invoke('dictionaries:select-file'),
    getInfo: (dictionaryId: string): Promise<DictionaryInfo> =>
      ipcRenderer.invoke('dictionaries:get-info', dictionaryId),
    import: (request: DictionaryImportRequest): Promise<ImportedDictionary> =>
      ipcRenderer.invoke('dictionaries:import', request),
    delete: (dictionaryId: string): Promise<void> =>
      ipcRenderer.invoke('dictionaries:delete', dictionaryId),
    openDirectory: (dictionaryId: string): Promise<void> =>
      ipcRenderer.invoke('dictionaries:open-directory', dictionaryId),
    reorder: (dictionaryIds: string[]): Promise<void> =>
      ipcRenderer.invoke('dictionaries:reorder', dictionaryIds),
    updateName: (dictionaryId: string, name: string): Promise<void> =>
      ipcRenderer.invoke('dictionaries:update-name', dictionaryId, name),
    updateCustomCss: (dictionaryId: string, customCss: string): Promise<void> =>
      ipcRenderer.invoke('dictionaries:update-custom-css', dictionaryId, customCss)
  }),
  onlineDictionaries: Object.freeze({
    list: (): Promise<OnlineDictionaryConfig[]> => ipcRenderer.invoke('online-dictionaries:list'),
    add: (input: Omit<OnlineDictionaryConfig, 'id'>): Promise<OnlineDictionaryConfig> =>
      ipcRenderer.invoke('online-dictionaries:add', input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('online-dictionaries:remove', id),
    reorder: (ids: string[]): Promise<void> =>
      ipcRenderer.invoke('online-dictionaries:reorder', ids)
  }),
  entries: Object.freeze({
    search: (prefix: string, limit?: number): Promise<DictionarySearchResult[]> =>
      ipcRenderer.invoke('dictionary-entries:search', prefix, limit),
    lookup: (term: string): Promise<DictionaryEntryGroup | null> =>
      ipcRenderer.invoke('dictionary-entries:lookup', term)
  }),
  history: Object.freeze({
    list: (): Promise<QueryHistoryItem[]> => ipcRenderer.invoke('query-history:list'),
    record: (term: string): Promise<void> => ipcRenderer.invoke('query-history:record', term),
    clear: (): Promise<void> => ipcRenderer.invoke('query-history:clear'),
    onChanged: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('query-history:changed', listener)
      return () => ipcRenderer.removeListener('query-history:changed', listener)
    }
  }),
  wordbooks: Object.freeze({
    list: (): Promise<WordbookSummary[]> => ipcRenderer.invoke('wordbooks:list'),
    create: (name: string): Promise<WordbookSummary> =>
      ipcRenderer.invoke('wordbooks:create', name),
    listWords: (wordbookId?: string, page = 1, pageSize = 25) =>
      ipcRenderer.invoke('wordbooks:list-words', wordbookId, page, pageSize),
    filterWords: (keyword: string, wordbookId?: string, page = 1, pageSize = 25) =>
      ipcRenderer.invoke('wordbooks:filter-words', keyword, wordbookId, page, pageSize),
    addWord: (word: string, star?: number): Promise<WordbookWordItem> =>
      ipcRenderer.invoke('wordbooks:add-word', word, star),
    importWords: (text: string, wordbookId?: string): Promise<WordbookImportResult> =>
      ipcRenderer.invoke('wordbooks:import-words', text, wordbookId),
    toggleStar: (word: string): Promise<void> => ipcRenderer.invoke('wordbooks:toggle-star', word),
    unStarWord: (word: string): Promise<void> => ipcRenderer.invoke('wordbooks:unstar-word', word),
    isStarred: (word: string): Promise<boolean> => ipcRenderer.invoke('wordbooks:is-starred', word),
    updateStar: (word: string, star: number): Promise<void> =>
      ipcRenderer.invoke('wordbooks:update-star', word, star),
    moveWords: (wordIds: string[], destinationWordbookId: string): Promise<void> =>
      ipcRenderer.invoke('wordbooks:move-words', wordIds, destinationWordbookId),
    export: (
      request: WordbookExportRequest,
      directoryPath: string
    ): Promise<{ started: boolean }> =>
      ipcRenderer.invoke('wordbooks:export', request, directoryPath),
    getExportStatus: (): Promise<WordbookExportStatus> =>
      ipcRenderer.invoke('wordbooks:export-status'),
    onExportStatus: (callback: (status: WordbookExportStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: WordbookExportStatus): void =>
        callback(status)
      ipcRenderer.on('wordbooks:export-status-changed', listener)
      return () => ipcRenderer.removeListener('wordbooks:export-status-changed', listener)
    },
    selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('wordbooks:select-directory'),
    deleteWordbook: (wordbookId: string): Promise<void> =>
      ipcRenderer.invoke('wordbooks:delete', wordbookId),
    renameWordbook: (wordbookId: string, name: string): Promise<void> =>
      ipcRenderer.invoke('wordbooks:rename', wordbookId, name)
  }),
  app: Object.freeze({
    getVersion: (): Promise<string | null> => ipcRenderer.invoke('app:get-version'),
    onDeepLink: (callback: (intent: DeepLinkIntent) => void): (() => void) => {
      deepLinkSubscribers.add(callback)
      while (pendingDeepLinks.length > 0) {
        const intent = pendingDeepLinks.shift()
        if (intent) callback(intent)
      }
      return () => deepLinkSubscribers.delete(callback)
    },
    onFocusSearch: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('app:focus-search', listener)
      return () => ipcRenderer.removeListener('app:focus-search', listener)
    },
    onShowFindBar: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('app:show-find-bar', listener)
      return () => ipcRenderer.removeListener('app:show-find-bar', listener)
    }
  }),
  keyboard: Object.freeze({
    getStatus: (): Promise<{ shortcut: string; registered: boolean } | null> =>
      ipcRenderer.invoke('keyboard:status'),
    setMainWindowShortcut: (
      shortcut: string
    ): Promise<{
      ok: boolean
      status: { shortcut: string; registered: boolean }
      error?: string
    } | null> => ipcRenderer.invoke('keyboard:set-main-window-shortcut', shortcut)
  }),
  notifications: Object.freeze({
    onToast: (callback: (payload: ToastPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ToastPayload): void =>
        callback(payload)
      ipcRenderer.on('notification:toast', listener)
      return () => ipcRenderer.removeListener('notification:toast', listener)
    }
  }),
  tts: Object.freeze({
    getConfig: (): Promise<TtsConfig | null> => ipcRenderer.invoke('tts:get-config'),
    saveConfig: (request: TtsSaveConfigRequest): Promise<TtsConfig | null> =>
      ipcRenderer.invoke('tts:save-config', request)
  }),
  aiLookup: Object.freeze({
    getConfig: (): Promise<AiLookupPublicConfig | null> =>
      ipcRenderer.invoke('ai-lookup:get-config'),
    saveConfig: (request: AiSaveConfigRequest): Promise<AiLookupPublicConfig | null> =>
      ipcRenderer.invoke('ai-lookup:save-config', request),
    startChat: (request: AiChatRequest): Promise<string | null> =>
      ipcRenderer.invoke('ai-lookup:start-chat', request),
    cancel: (requestId: string): void => ipcRenderer.send('ai-lookup:cancel', requestId),
    onEvent: (callback: (event: AiStreamEventPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AiStreamEventPayload): void =>
        callback(payload)
      ipcRenderer.on('ai-lookup:event', listener)
      return () => ipcRenderer.removeListener('ai-lookup:event', listener)
    }
  }),
  searchPopover: Object.freeze({
    show: (): void => ipcRenderer.send('search-popover:show'),
    hide: (): void => ipcRenderer.send('search-popover:hide'),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }): void =>
      ipcRenderer.send('search-popover:set-bounds', bounds),
    update: (
      query: string,
      items: SearchPopoverItem[],
      selectedIndex: number,
      status?: 'loading' | 'empty'
    ): void => ipcRenderer.send('search-popover:update', { query, items, selectedIndex, status }),
    onSelect: (callback: (word: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, word: string): void => callback(word)
      ipcRenderer.on('search-popover:selected', listener)
      return () => ipcRenderer.removeListener('search-popover:selected', listener)
    },
    onQueryChange: (callback: (query: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, query: string): void => callback(query)
      ipcRenderer.on('search-popover:query-changed', listener)
      return () => ipcRenderer.removeListener('search-popover:query-changed', listener)
    },
    onSubmit: (callback: (query: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, query: string): void => callback(query)
      ipcRenderer.on('search-popover:submitted', listener)
      return () => ipcRenderer.removeListener('search-popover:submitted', listener)
    },
    onDismiss: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('search-popover:dismissed', listener)
      return () => ipcRenderer.removeListener('search-popover:dismissed', listener)
    },
    onShown: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('search-popover:shown', listener)
      return () => ipcRenderer.removeListener('search-popover:shown', listener)
    },
    onHidden: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('search-popover:hidden', listener)
      return () => ipcRenderer.removeListener('search-popover:hidden', listener)
    }
  }),
  wordCapture: Object.freeze({
    getStatus: (): Promise<WordCaptureStatus | null> => ipcRenderer.invoke('word-capture:status'),
    requestAccess: (): Promise<WordCaptureStatus | null> =>
      ipcRenderer.invoke('word-capture:request-access'),
    openInputMonitoringSettings: (): Promise<OpenInputMonitoringSettingsResult | null> =>
      ipcRenderer.invoke('word-capture:open-input-monitoring-settings'),
    setShortcut: (shortcut: string): Promise<WordCaptureShortcutResult | null> =>
      ipcRenderer.invoke('word-capture:set-shortcut', shortcut),
    setSelectionEnabled: (enabled: boolean): Promise<WordCaptureShortcutResult | null> =>
      ipcRenderer.invoke('word-capture:set-selection-enabled', enabled),
    removeExcludedProgram: (programName: string): Promise<WordCaptureShortcutResult | null> =>
      ipcRenderer.invoke('word-capture:remove-excluded-program', programName),
    onEvent: (callback: (event: WordCaptureEvent) => void): (() => void) => {
      wordCaptureSubscribers.add(callback)
      if (pendingWordCaptureEvent) {
        const captureEvent = pendingWordCaptureEvent
        pendingWordCaptureEvent = undefined
        callback(captureEvent)
      }
      return () => wordCaptureSubscribers.delete(callback)
    }
  }),
  dictionaryView: Object.freeze({
    show: (entryId: string): Promise<void> => ipcRenderer.invoke('dictionary-view:show', entryId),
    hide: (): void => ipcRenderer.send('dictionary-view:hide'),
    showFindBar: (): void => ipcRenderer.send('dictionary-view:show-find-bar'),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }): void =>
      ipcRenderer.send('dictionary-view:set-bounds', bounds),
    onLoadingChanged: (callback: (isLoading: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isLoading: boolean): void =>
        callback(isLoading)
      ipcRenderer.on('dictionary-view:loading-changed', listener)
      return () => ipcRenderer.removeListener('dictionary-view:loading-changed', listener)
    },
    onLookupWord: (callback: (word: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, word: string): void => callback(word)
      ipcRenderer.on('dictionary-view:lookup-word', listener)
      return () => ipcRenderer.removeListener('dictionary-view:lookup-word', listener)
    },
    onExplainWithAi: (callback: (text: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
      ipcRenderer.on('dictionary-view:explain-with-ai', listener)
      return () => ipcRenderer.removeListener('dictionary-view:explain-with-ai', listener)
    }
  }),
  embedBrowser: Object.freeze({
    load: (url: string): Promise<void> => ipcRenderer.invoke('embed-browser:load', url),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }): void =>
      ipcRenderer.send('embed-browser:set-bounds', bounds),
    hide: (): void => ipcRenderer.send('embed-browser:hide'),
    onUrlChanged: (callback: (url: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, url: string): void => callback(url)
      ipcRenderer.on('embed-browser:url-changed', listener)
      return () => ipcRenderer.removeListener('embed-browser:url-changed', listener)
    },
    onLoadingChanged: (callback: (isLoading: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isLoading: boolean): void =>
        callback(isLoading)
      ipcRenderer.on('embed-browser:loading-changed', listener)
      return () => ipcRenderer.removeListener('embed-browser:loading-changed', listener)
    }
  })
})

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
try {
  contextBridge.exposeInMainWorld('dictol', api)
} catch (error) {
  console.error(error)
}
