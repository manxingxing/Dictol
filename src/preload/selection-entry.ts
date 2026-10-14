import { contextBridge, ipcRenderer } from 'electron'
import { createTtsPlayback } from './tts'

contextBridge.exposeInMainWorld(
  'dictolEntry',
  Object.freeze({
    tts: createTtsPlayback(),
    lookupWord: (word: string): void => ipcRenderer.send('selection-explanation:lookup-word', word),
    copyText: (text: string): void => ipcRenderer.send('selection-explanation:copy-text', text)
  })
)
