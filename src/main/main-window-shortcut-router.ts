import { type BrowserWindow, type Event, type Input, type WebContents } from 'electron'

import { parseDictionaryEntryUrl } from './dictionary-entry-url'
import type { WindowManager } from './window-manager'

type MainWindowShortcutTarget =
  'main' | 'dictionary' | 'aggregate-dictionary' | 'search-popover' | 'find-bar' | 'embed-browser'
type ShortcutAction = 'focus-search' | 'show-find-bar' | 'previous-dictionary' | 'next-dictionary'

type Registration = {
  webContents: WebContents
  listener: (event: Event, input: Input) => void
  destroyedListener: () => void
}

export class MainWindowShortcutRouter {
  private readonly registrations = new Map<number, Registration>()

  constructor(
    private readonly windowManager: WindowManager,
    private readonly mainWindow: BrowserWindow
  ) {}

  register(
    webContents: WebContents,
    target: MainWindowShortcutTarget,
    allowedActions?: readonly ShortcutAction[]
  ): void {
    if (webContents.isDestroyed() || this.registrations.has(webContents.id)) return

    const listener = (event: Event, input: Input): void => {
      if (this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) {
        return
      }

      const allows = (action: ShortcutAction): boolean =>
        !allowedActions || allowedActions.includes(action)

      if (allows('focus-search') && matchesPrimaryShortcut(input, 'k')) {
        event.preventDefault()
        if (target === 'search-popover') {
          webContents.focus()
          webContents.send('search-popover:focus-input')
          return
        }

        this.windowManager.focusMainWindowRenderer()
        this.mainWindow.webContents.send('app:focus-search')
        return
      }

      if (allows('show-find-bar') && matchesPrimaryShortcut(input, 'f')) {
        event.preventDefault()
        this.mainWindow.webContents.send('app:show-find-bar')
        return
      }

      if (
        target === 'dictionary' &&
        ((allows('previous-dictionary') && matchesPrimaryShortcut(input, 'arrowleft')) ||
          (allows('next-dictionary') && matchesPrimaryShortcut(input, 'arrowright')))
      ) {
        const dictionaryId = parseDictionaryEntryUrl(webContents.getURL())?.dictionaryId
        if (dictionaryId === undefined) return
        event.preventDefault()
        this.mainWindow.webContents.send('dictionary-view:switch-dictionary', {
          direction: input.key.toLowerCase() === 'arrowleft' ? 'left' : 'right',
          dictionaryId: String(dictionaryId)
        })
      }
    }
    const destroyedListener = (): void => {
      this.registrations.delete(webContents.id)
    }

    webContents.on('before-input-event', listener)
    webContents.once('destroyed', destroyedListener)
    this.registrations.set(webContents.id, { webContents, listener, destroyedListener })
  }

  dispose(): void {
    for (const registration of this.registrations.values()) {
      registration.webContents.removeListener('before-input-event', registration.listener)
      registration.webContents.removeListener('destroyed', registration.destroyedListener)
    }
    this.registrations.clear()
  }
}

function matchesPrimaryShortcut(input: Input, key: string): boolean {
  if (
    input.type !== 'keyDown' ||
    input.key.toLowerCase() !== key ||
    input.alt ||
    input.shift
  ) {
    return false
  }
  return process.platform === 'darwin' ? input.meta && !input.control : input.control
}
