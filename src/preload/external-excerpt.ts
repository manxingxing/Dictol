import { contextBridge, ipcRenderer } from 'electron'

import type { ExternalExcerptCapture } from '../shared/selection-toolbar'

type Subscriber = (payload: ExternalExcerptCapture) => void

let latestPayload: ExternalExcerptCapture | undefined
const subscribers = new Set<Subscriber>()

ipcRenderer.on('external-excerpt:update', (_event, payload: ExternalExcerptCapture) => {
  latestPayload = payload
  subscribers.forEach((subscriber) => subscriber(payload))
})

contextBridge.exposeInMainWorld(
  'dictolExternalExcerpt',
  Object.freeze({
    onUpdate: (callback: Subscriber): (() => void) => {
      subscribers.add(callback)
      if (latestPayload) callback(latestPayload)
      return () => subscribers.delete(callback)
    },
    save: (input: { excerpt: string; relatedTerms: string[]; comment: string }): Promise<void> =>
      ipcRenderer.invoke('external-excerpt:save', input),
    generateNote: (input: { excerpt: string; relatedTerms: string[] }): Promise<string> =>
      ipcRenderer.invoke('external-excerpt:generate-note', input)
  })
)
