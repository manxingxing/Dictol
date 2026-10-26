import { contextBridge, ipcRenderer } from 'electron'
import { createTtsPlayback } from './tts'

window.addEventListener(
  'pointerdown',
  () => {
    ipcRenderer.send('dictionary-view:pointer-down')
  },
  { capture: true }
)

contextBridge.exposeInMainWorld(
  'dictolEntry',
  Object.freeze({
    tts: createTtsPlayback(),
    lookupWord: (word: string): void => ipcRenderer.send('dictionary-view:lookup-word', word),
    canExplainWithAi: (): Promise<boolean> =>
      ipcRenderer.invoke('dictionary-view:can-explain-with-ai'),
    explainWithAi: (text: string): void =>
      ipcRenderer.send('dictionary-view:explain-with-ai', text),
    openNote: (text: string, sourceDictionaryId?: number): void =>
      ipcRenderer.send('dictionary-view:open-note', text, sourceDictionaryId),
    copyText: (text: string): Promise<void> =>
      ipcRenderer.invoke('dictionary-view:copy-text', text),
    onScrollToDictionary: (callback: (dictionaryId: number) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, dictionaryId: number): void =>
        callback(dictionaryId)
      ipcRenderer.on('dictionary-view:scroll-to-dictionary', listener)
      return () => ipcRenderer.removeListener('dictionary-view:scroll-to-dictionary', listener)
    },
    onLayoutChanged: (callback: (layout: 'vertical' | 'horizontal') => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        layout: 'vertical' | 'horizontal'
      ): void => callback(layout)
      ipcRenderer.on('dictionary-view:layout-changed', listener)
      return () => ipcRenderer.removeListener('dictionary-view:layout-changed', listener)
    },
    notifyActiveDictionary: (dictionaryId: number): void => {
      ipcRenderer.send('dictionary-view:active-dictionary', dictionaryId)
    },
    onAiExplanationAvailabilityChanged: (callback: (enabled: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, enabled: boolean): void =>
        callback(enabled)
      ipcRenderer.on('dictionary-view:ai-explanation-availability-changed', listener)
      return () =>
        ipcRenderer.removeListener('dictionary-view:ai-explanation-availability-changed', listener)
    }
  })
)
