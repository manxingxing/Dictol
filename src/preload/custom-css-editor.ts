import { contextBridge, ipcRenderer } from 'electron'

import type {
  CustomCssEditorBounds,
  CustomCssEditorDictionary,
  CustomCssEditorSearchResult,
  CustomCssEditorTheme
} from '../shared/custom-css-editor'

contextBridge.exposeInMainWorld(
  'dictolCustomCssEditor',
  Object.freeze({
    getDictionary: (dictionaryId: string): Promise<CustomCssEditorDictionary> =>
      ipcRenderer.invoke('custom-css-editor:get-dictionary', dictionaryId),
    searchEntry: (dictionaryId: string, term: string): Promise<CustomCssEditorSearchResult> =>
      ipcRenderer.invoke('custom-css-editor:search-entry', dictionaryId, term),
    setPreviewBounds: (bounds: CustomCssEditorBounds): void =>
      ipcRenderer.send('custom-css-editor:set-preview-bounds', bounds),
    setPreviewTheme: (theme: CustomCssEditorTheme): void =>
      ipcRenderer.send('custom-css-editor:set-preview-theme', theme),
    openDevTools: (): void => ipcRenderer.send('custom-css-editor:open-devtools'),
    previewCss: (css: string): void => ipcRenderer.send('custom-css-editor:preview-css', css),
    save: (dictionaryId: string, css: string): Promise<void> =>
      ipcRenderer.invoke('custom-css-editor:save', dictionaryId, css),
    onEntryWord: (callback: (word: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, word: string): void => callback(word)
      ipcRenderer.on('custom-css-editor:entry-word', listener)
      return () => ipcRenderer.removeListener('custom-css-editor:entry-word', listener)
    },
    onPreviewReady: (callback: (ready: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ready: boolean): void => callback(ready)
      ipcRenderer.on('custom-css-editor:preview-ready', listener)
      return () => ipcRenderer.removeListener('custom-css-editor:preview-ready', listener)
    }
  })
)
