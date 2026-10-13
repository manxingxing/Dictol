import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld(
  'dictolEntry',
  Object.freeze({
    lookupWord: (word: string): void => ipcRenderer.send('selection-explanation:lookup-word', word),
    copyText: (text: string): void => ipcRenderer.send('selection-explanation:copy-text', text)
  })
)
