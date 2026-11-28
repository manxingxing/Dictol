import { app } from 'electron'
import {
  DEEP_LINK_SCHEME,
  findDeepLink,
  parseDeepLink,
  type DeepLinkIntent
} from '../shared/deep-link'
import type { AppRuntime } from './app-runtime'

/** Register early to receive macOS launch URLs, then start dispatching once the runtime is ready. */
export function registerDeepLinks(runtime: AppRuntime): () => void {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  }

  let pendingWindowActivation = false
  let readyForDeepLinks = false
  const pendingDeepLinks: DeepLinkIntent[] = []

  const flushDeepLinks = (): void => {
    if (!readyForDeepLinks) return

    for (const { type, text } of pendingDeepLinks.splice(0)) {
      switch (type) {
        case 'dict':
          runtime.activateMainWindow()
          sendDeepLinkSearch(runtime, text)
          break
        case 'lookup':
          void runtime.actions.explanation.lookupAtCursor(text).catch((error: unknown) => {
            console.error('Failed to open explanation from Deep Link', error)
          })
          break
        case 'translate':
          runtime.actions.translation.showSelection(text)
          break
      }
    }
  }

  const handleDeepLink = (readIntent: () => DeepLinkIntent | null): boolean => {
    let intent: DeepLinkIntent | null
    try {
      intent = readIntent()
    } catch (error) {
      console.warn('Invalid Dictol Deep Link', error)
      return true
    }

    if (!intent) return false
    pendingDeepLinks.push(intent)
    flushDeepLinks()
    return true
  }

  handleDeepLink(() => findDeepLink(process.argv))
  app.on('second-instance', (_event, commandLine) => {
    if (handleDeepLink(() => findDeepLink(commandLine))) return
    if (readyForDeepLinks) runtime.activateMainWindow()
    else pendingWindowActivation = true
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(() => parseDeepLink(url))
  })

  return () => {
    readyForDeepLinks = true
    if (pendingWindowActivation || pendingDeepLinks.length === 0) runtime.activateMainWindow()
    flushDeepLinks()
  }
}

function sendDeepLinkSearch(runtime: AppRuntime, term: string): void {
  const mainWindow = runtime.mainWindow
  if (!mainWindow) throw new Error('主窗口尚未初始化')
  const contents = mainWindow.webContents
  const send = (): void => {
    if (!contents.isDestroyed()) contents.send('app:search-request', { term, source: 'deep-link' })
  }
  if (contents.isLoadingMainFrame()) contents.once('did-finish-load', send)
  else send()
}
