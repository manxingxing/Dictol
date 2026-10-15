import { contextBridge, ipcRenderer } from 'electron'

import type { SelectionToolbarPayload } from '../shared/selection-toolbar'

type Subscriber = (payload: SelectionToolbarPayload) => void

let latestPayload: SelectionToolbarPayload | undefined
const subscribers = new Set<Subscriber>()

ipcRenderer.on('selection-toolbar:update', (_event, payload: SelectionToolbarPayload) => {
  latestPayload = payload
  subscribers.forEach((subscriber) => subscriber(payload))
})

contextBridge.exposeInMainWorld(
  'dictolSelectionToolbar',
  Object.freeze({
    platform: process.platform,
    onUpdate: (callback: Subscriber): (() => void) => {
      subscribers.add(callback)
      if (latestPayload) callback(latestPayload)
      return () => subscribers.delete(callback)
    },
    lookupInMain: (): void => ipcRenderer.send('selection-toolbar:lookup-in-main'),
    explain: (): void => ipcRenderer.send('selection-toolbar:explain'),
    copy: (): void => ipcRenderer.send('selection-toolbar:copy'),
    captureExcerpt: (): Promise<void> => ipcRenderer.invoke('selection-toolbar:capture-excerpt'),
    openMenu: (): void => ipcRenderer.send('selection-toolbar:open-menu'),
    activity: (): void => ipcRenderer.send('selection-toolbar:activity'),
    rendered: (requestId: number): void => ipcRenderer.send('selection-toolbar:rendered', requestId)
  })
)
