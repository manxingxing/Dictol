import { contextBridge, ipcRenderer } from 'electron'

import type { SelectionExplanationPayload } from '../shared/selection-explanation'

export type { SelectionExplanationPayload } from '../shared/selection-explanation'

type Subscriber = (payload: SelectionExplanationPayload) => void

let latestPayload: SelectionExplanationPayload | undefined
const subscribers = new Set<Subscriber>()

ipcRenderer.on('selection-explanation:update', (_event, payload: SelectionExplanationPayload) => {
  latestPayload = payload
  subscribers.forEach((subscriber) => subscriber(payload))
})

contextBridge.exposeInMainWorld(
  'dictolSelectionExplanation',
  Object.freeze({
    onUpdate: (callback: Subscriber): (() => void) => {
      subscribers.add(callback)
      if (latestPayload) callback(latestPayload)
      return () => subscribers.delete(callback)
    },
    loadingReady: (requestId: number): void =>
      ipcRenderer.send('selection-explanation:loading-ready', requestId),
    selectDictionary: (dictionaryId: string): void =>
      ipcRenderer.send('selection-explanation:select-dictionary', dictionaryId),
    close: (): void => ipcRenderer.send('selection-explanation:close'),
    openInMain: (): void => ipcRenderer.send('selection-explanation:open-in-main'),
    isStarred: (word: string): Promise<boolean> =>
      ipcRenderer.invoke('selection-explanation:is-starred', word),
    toggleStar: (word: string): Promise<void> =>
      ipcRenderer.invoke('selection-explanation:toggle-star', word)
  })
)
