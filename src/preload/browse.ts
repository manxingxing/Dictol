import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld(
  'dictolBrowse',
  Object.freeze({
    getDictionaryName: (dictionaryId: string): Promise<string | null> =>
      ipcRenderer.invoke('browse:get-dictionary-name', dictionaryId),
    listEntryWords: (dictionaryId: string): Promise<string[]> =>
      ipcRenderer.invoke('browse:list-entry-words', dictionaryId),
    prefixEntryWords: (dictionaryId: string, prefix: string): Promise<string[]> =>
      ipcRenderer.invoke('browse:prefix-entry-words', dictionaryId, prefix),
    lookup: (dictionaryId: string, term: string) =>
      ipcRenderer.invoke('browse:lookup-in-main-window', dictionaryId, term)
  })
)
