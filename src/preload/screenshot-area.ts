import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld(
  'dictolScreenshotArea',
  Object.freeze({
    complete: (region: { x: number; y: number; width: number; height: number }): void =>
      ipcRenderer.send('screenshot-translation:complete', region),
    cancel: (): void => ipcRenderer.send('screenshot-translation:cancel')
  })
)
