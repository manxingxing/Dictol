import { globalShortcut } from 'electron'

export interface ShortcutHandler {
  handleShortcut(): void | Promise<void>
}

export class ShortcutRegister {
  private readonly registrations = new Map<string, string>()

  register(command: string, shortcut: string, handler: ShortcutHandler): boolean {
    // 注销原来的快捷键
    this.unregister(command)

    if (!shortcut) {
      console.warn('Invalid shortcut configuration', { command, shortcut })
      return false
    }

    try {
      const registered = globalShortcut.register(shortcut, () => {
        try {
          void Promise.resolve(handler.handleShortcut()).catch((error: unknown) => {
            console.error('Shortcut handler failed', { command, error })
          })
        } catch (error) {
          console.error('Shortcut handler failed', { command, error })
        }
      })
      if (!registered) {
        console.warn('Shortcut is unavailable', { command, shortcut })
        return false
      }
      this.registrations.set(command, shortcut)
      return true
    } catch (error) {
      console.error('Failed to register shortcut', { command, shortcut, error })
      return false
    }
  }

  unregister(command: string): void {
    const accelerator = this.registrations.get(command)
    if (!accelerator) return
    globalShortcut.unregister(accelerator)
    this.registrations.delete(command)
  }

  unregisterAccelerator(accelerator: string): void {
    for (const [command, registeredAccelerator] of this.registrations.entries()) {
      if (registeredAccelerator === accelerator) {
        globalShortcut.unregister(accelerator)
        this.registrations.delete(command)
        return
      }
    }
  }

  unregisterAll(): void {
    for (const command of [...this.registrations.keys()]) this.unregister(command)
  }

  isRegistered(command: string): boolean {
    return this.registrations.has(command) && globalShortcut.isRegistered(this.registrations.get(command)!)
  }

  suspendAllShortCuts(): void {
    globalShortcut.setSuspended(true)
  }

  resumeAllShortCuts(): void {
    globalShortcut.setSuspended(false)
  }
}
