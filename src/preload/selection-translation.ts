import { contextBridge, ipcRenderer } from 'electron'
import type {
  SelectionTranslationPayload,
  TranslationEvent,
  TranslationPublicConfig,
  TranslationRequest
} from '../shared/translation'

let latestPayload: SelectionTranslationPayload | undefined
const subscribers = new Set<(payload: SelectionTranslationPayload) => void>()

ipcRenderer.on('selection-translation:update', (_event, payload: SelectionTranslationPayload) => {
  latestPayload = payload
  subscribers.forEach((subscriber) => subscriber(payload))
})

contextBridge.exposeInMainWorld(
  'dictolSelectionTranslation',
  Object.freeze({
    onUpdate: (callback: (payload: SelectionTranslationPayload) => void): (() => void) => {
      subscribers.add(callback)
      if (latestPayload) callback(latestPayload)
      return () => subscribers.delete(callback)
    },
    getConfig: (): Promise<TranslationPublicConfig | null> =>
      ipcRenderer.invoke('translation:get-config'),
    start: (request: TranslationRequest): Promise<string | null> =>
      ipcRenderer.invoke('translation:start', request),
    cancel: (requestId: string): void => ipcRenderer.send('translation:cancel', requestId),
    onEvent: (callback: (event: TranslationEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TranslationEvent): void =>
        callback(payload)
      ipcRenderer.on('translation:event', listener)
      return () => ipcRenderer.removeListener('translation:event', listener)
    },
    setDesiredHeight: (version: number, height: number): void =>
      ipcRenderer.send('selection-translation:desired-height', version, height),
    togglePin: (): Promise<boolean> => ipcRenderer.invoke('selection-translation:toggle-pin'),
    close: (): void => ipcRenderer.send('selection-translation:close')
  })
)
