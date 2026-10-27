import { contextBridge, ipcRenderer } from 'electron'
import { createTtsPlayback } from './tts'
import { installDictionarySwipe } from './dictionary-swipe'

installDictionarySwipe('selection-explanation:swipe-dictionary')

contextBridge.exposeInMainWorld(
  'dictolEntry',
  Object.freeze({
    tts: createTtsPlayback(),
    lookupWord: (word: string): void => ipcRenderer.send('selection-explanation:lookup-word', word),
    copyText: (text: string): Promise<void> =>
      ipcRenderer.invoke('selection-explanation:copy-text', text),
    openNote: (text: string): void => ipcRenderer.send('selection-explanation:create-note', text)
  })
)
