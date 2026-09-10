import { type BrowserWindow, type Event, type Input, type WebContents } from 'electron'

import type { WindowManager } from './window-manager'

type MainWindowShortcutTarget =
  'main' | 'dictionary' | 'aggregate-dictionary' | 'search-popover' | 'find-bar' | 'embed-browser'
type ShortcutAction = 'focus-search' | 'show-find-bar'

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
      const action = getShortcutAction(input)
      if (
        !action ||
        (allowedActions && !allowedActions.includes(action)) ||
        this.mainWindow.isDestroyed() ||
        this.mainWindow.webContents.isDestroyed()
      ) {
        return
      }

      event.preventDefault()

      if (action === 'focus-search') {
        if (target === 'search-popover') {
          webContents.focus()
          webContents.send('search-popover:focus-input')
          return
        }

        this.windowManager.focusMainWindowRenderer()
        this.mainWindow.webContents.send('app:focus-search')
        return
      }

      this.mainWindow.webContents.send('app:show-find-bar')
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

function getShortcutAction(input: Input): ShortcutAction | undefined {
  const usesPlatformModifier =
    process.platform === 'darwin' ? input.meta && !input.control : input.control
  if (input.type !== 'keyDown' || !usesPlatformModifier || input.alt || input.shift) {
    return undefined
  }

  const key = input.key.toLowerCase()
  if (key === 'k') return 'focus-search'
  if (key === 'f') return 'show-find-bar'
  return undefined
}
