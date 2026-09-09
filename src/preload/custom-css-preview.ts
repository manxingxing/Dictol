import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld(
  'dictolEntry',
  Object.freeze({
    readAloud: (text: string, voice?: string): Promise<Uint8Array | null> =>
      ipcRenderer.invoke('entry:read-aloud', text, voice)
  })
)
