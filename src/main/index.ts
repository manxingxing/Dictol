import { app, shell, type BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { resolveRendererUrl } from './output-path'

import { getAppRunTime } from './app-runtime'
import { registerDeepLinks } from './deep-link'
import { registerIPCHandlers } from './controller/ipc-register'
import {
  registerResourceProtocolHandlers,
  registerResourceSchemes
} from './resource-protocol-handlers'
import { installAppMenu } from './app-menu'

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  // Do not initialize the database, tray, global shortcuts, or native selection
  // hook in a secondary process. The primary process receives `second-instance`.
  app.quit()
} else {
  registerResourceSchemes()
  startPrimaryInstance()
}

function startPrimaryInstance(): void {
  const runtime = getAppRunTime()
  let runtimeDisposed = false

  process.on('unhandledRejection', (reason: unknown) => {
    console.error('Unhandled promise rejection in Electron main process', reason)
  })

  const finishDeepLinkStartup = registerDeepLinks(runtime)
  void app
    .whenReady()
    .then(async () => {
      electronApp.setAppUserModelId('com.dictol.app')
      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      try {
        registerResourceProtocolHandlers(runtime)
        await runtime.initialize()
        registerIPCHandlers(runtime)
        installAppMenu(runtime)
        runtime.setMainWindowInitializer(configureMainWindow)
        configureMainWindow(requireMainWindow(runtime))
        finishDeepLinkStartup()
      } catch (error: unknown) {
        console.error('Failed to initialize application', error)
        disposeRuntime()
        app.quit()
        return
      }

      app.on('activate', (_event, hasVisibleWindows) => {
        // Native selection panels are visible AppKit windows, but their hidden
        // Electron BrowserWindow hosts are intentionally absent from Electron's
        // visible-window count. Activating one of those panels must not treat
        // the application as freshly reopened and raise the obscured main window.
        if (!hasVisibleWindows && !runtime.windowManager.hasVisibleSelectionSurface()) {
          runtime.activateMainWindow()
        }
      })

      app.on('window-all-closed', () => {
        // Registering this handler prevents Electron's default non-macOS quit,
        // keeping the app available through its tray after its last window closes.
        // The explicit tray Quit action still calls app.quit().
        return undefined
      })
    })
    .catch((error: unknown) => {
      console.error('Failed while preparing the application', error)
      disposeRuntime()
      app.quit()
    })

  app.on('before-quit', () => {
    disposeRuntime()
  })

  function disposeRuntime(): void {
    if (runtimeDisposed) return
    runtimeDisposed = true
    runtime.dispose()
  }
}

function configureMainWindow(mainWindow: BrowserWindow): void {
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url).catch((error: unknown) => {
        console.error('Failed to open external URL', { url, error })
      })
    }
    return { action: 'deny' }
  })

  void mainWindow.loadURL(`${resolveRendererUrl('index.html')}#/search`).catch((error: unknown) => {
    console.error('Failed to load renderer', error)
  })
}

function requireMainWindow(runtime: ReturnType<typeof getAppRunTime>): BrowserWindow {
  const mainWindow = runtime.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口尚未初始化')
  return mainWindow
}
