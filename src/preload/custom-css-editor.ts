import { contextBridge, ipcRenderer } from 'electron'

import type {
  CustomCssEditorBounds,
  CustomCssEditorSearchResult,
  CustomCssEditorState,
  CustomCssEditorTheme
} from '../shared/custom-css-editor'

contextBridge.exposeInMainWorld(
  'dictolCustomCssEditor',
  Object.freeze({
    getState: (): Promise<CustomCssEditorState | null> =>
      ipcRenderer.invoke('custom-css-editor:get-state'),
    getPreviewReady: (): Promise<boolean> =>
      ipcRenderer.invoke('custom-css-editor:get-preview-ready'),
    randomEntry: (): Promise<CustomCssEditorState> =>
      ipcRenderer.invoke('custom-css-editor:random-entry'),
    searchEntry: (term: string): Promise<CustomCssEditorSearchResult> =>
      ipcRenderer.invoke('custom-css-editor:search-entry', term),
    setPreviewBounds: (bounds: CustomCssEditorBounds): void =>
      ipcRenderer.send('custom-css-editor:set-preview-bounds', bounds),
    setPreviewTheme: (theme: CustomCssEditorTheme): void =>
      ipcRenderer.send('custom-css-editor:set-preview-theme', theme),
    openDevTools: (): void => ipcRenderer.send('custom-css-editor:open-devtools'),
    previewCss: (css: string): void => ipcRenderer.send('custom-css-editor:preview-css', css),
    save: (css: string): Promise<void> => ipcRenderer.invoke('custom-css-editor:save', css),
    onState: (callback: (state: CustomCssEditorState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: CustomCssEditorState): void =>
        callback(state)
      ipcRenderer.on('custom-css-editor:state', listener)
      return () => ipcRenderer.removeListener('custom-css-editor:state', listener)
    },
    onPreviewReady: (callback: (ready: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ready: boolean): void => callback(ready)
      ipcRenderer.on('custom-css-editor:preview-ready', listener)
      return () => ipcRenderer.removeListener('custom-css-editor:preview-ready', listener)
    }
  })
)
