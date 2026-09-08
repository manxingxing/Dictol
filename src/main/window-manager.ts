import { BrowserWindow, nativeTheme, systemPreferences } from 'electron'

import icon from '../../resources/icon.png?asset'
import {
  SELECTION_EXPLANATION_DICTIONARY_SWITCHER_HEIGHT,
  SELECTION_EXPLANATION_HEADER_HEIGHT
} from '../shared/selection-explanation'
import { getSelectionToolbarWindowSize } from '../shared/selection-toolbar'
import { MAIN_WINDOW_TITLEBAR_HEIGHT } from '../shared/window-chrome'
import { DICTIONARY_SESSION_PARTITION } from './entry-assets'
import { resolvePreloadPath } from './output-path'
import { applySelectionWindowBehavior, hideSelectionWindow } from './selection-window-behavior'
import { WebContentsViewManager } from './web-contents-view-manager'

const getMainWindowBackgroundColor = (useDarkColors: boolean): string =>
  process.platform === 'darwin' ? '#00000000' : useDarkColors ? '#171a18' : '#faf9f7'

export class WindowManager {
  mainWindow: BrowserWindow | undefined
  dictionaryView: WebContentsViewManager | undefined
  embedBrowserView: WebContentsViewManager | undefined
  searchPopoverView: WebContentsViewManager | undefined
  selectionToolbarWindow: BrowserWindow | undefined
  selectionExplanationWindow: BrowserWindow | undefined
  selectionExplanationView: WebContentsViewManager | undefined
  findBarView: WebContentsViewManager | undefined
  customCssEditorWindow: BrowserWindow | undefined
  customCssEditorPreviewView: WebContentsViewManager | undefined
  private activeSpaceSubscriptionId: number | undefined
  private observingNativeAppearance = false
  private selectionExplanationSwitcherVisible = false
  private updateSelectionExplanationViewBounds: (() => void) | undefined

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow

    this.dictionaryView?.dispose()
    this.embedBrowserView?.dispose()
    this.searchPopoverView?.dispose()
    this.findBarView?.dispose()
    this.dictionaryView = undefined
    this.embedBrowserView = undefined
    this.searchPopoverView = undefined
    this.findBarView = undefined

    const darkMode = nativeTheme.shouldUseDarkColors
    // Create the browser window.
    const mainWindow = new BrowserWindow({
      width: 900,
      height: 670,
      minWidth: 520,
      minHeight: 520,
      show: false,
      backgroundColor: getMainWindowBackgroundColor(darkMode),
      autoHideMenuBar: true,
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hidden' as const,
            trafficLightPosition: { x: 16, y: 16 },
            transparent: true,
            vibrancy: 'sidebar' as const,
            visualEffectState: 'active' as const
          }
        : process.platform === 'win32'
          ? {
              titleBarStyle: 'hidden' as const,
              titleBarOverlay: {
                color: '#00000000',
                symbolColor: darkMode ? '#dddeda' : '#534f48',
                height: MAIN_WINDOW_TITLEBAR_HEIGHT
              }
            }
          : {}),
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: resolvePreloadPath('index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    if (!this.observingNativeAppearance) {
      nativeTheme.on('updated', this.updateNativeAppearance)
      this.observingNativeAppearance = true
    }
    this.mainWindow = mainWindow
    mainWindow.on('closed', () => {
      if (this.mainWindow === mainWindow) this.mainWindow = undefined
    })
    return mainWindow
  }

  createDictionaryView(): WebContentsViewManager {
    if (this.dictionaryView && !this.dictionaryView.isDestroyed) {
      return this.dictionaryView
    }

    const mainWindow = this.requireMainWindow()
    const dictionaryView = new WebContentsViewManager(mainWindow, {
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#212121' : '#ffffff',
      view: {
        webPreferences: {
          partition: DICTIONARY_SESSION_PARTITION,
          preload: resolvePreloadPath('dictionary.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          // Chromium only dispatches file: subresources from dictol-entry: pages to
          // the session protocol handler when web security is disabled. This view's
          // dedicated session intercepts every file: request and never falls through
          // to Chromium's built-in local-file loader.
          webSecurity: false
        }
      }
    })

    this.dictionaryView = dictionaryView
    return dictionaryView
  }

  createSearchPopoverView(): WebContentsViewManager {
    if (this.searchPopoverView && !this.searchPopoverView.isDestroyed) {
      return this.searchPopoverView
    }

    const mainWindow = this.requireMainWindow()
    const searchPopoverView = new WebContentsViewManager(mainWindow, {
      backgroundColor: '#00000000',
      view: {
        webPreferences: {
          preload: resolvePreloadPath('search-popover.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true
        }
      }
    })

    this.searchPopoverView = searchPopoverView
    return searchPopoverView
  }

  createEmbedBrowserView(): WebContentsViewManager {
    if (this.embedBrowserView && !this.embedBrowserView.isDestroyed) {
      return this.embedBrowserView
    }

    const mainWindow = this.requireMainWindow()
    const embedBrowserView = new WebContentsViewManager(mainWindow, {
      view: {
        webPreferences: {
          partition: 'persist:dictol-embed-browser',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true
        }
      }
    })

    this.embedBrowserView = embedBrowserView
    return embedBrowserView
  }

  createFindBarView(): WebContentsViewManager {
    if (this.findBarView && !this.findBarView.isDestroyed) {
      return this.findBarView
    }

    const mainWindow = this.requireMainWindow()
    const findBarView = new WebContentsViewManager(mainWindow, {
      backgroundColor: '#00000000',
      view: {
        webPreferences: {
          preload: resolvePreloadPath('find-bar.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true
        }
      }
    })

    this.findBarView = findBarView
    return findBarView
  }

  createSelectionToolbarWindow(): BrowserWindow {
    if (this.selectionToolbarWindow && !this.selectionToolbarWindow.isDestroyed()) {
      return this.selectionToolbarWindow
    }

    const initialSize = getSelectionToolbarWindowSize(false, process.platform)
    const window = new BrowserWindow({
      ...initialSize,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      // The Windows controller reveals the first fully rendered frame and then
      // uses opacity for logical hide/show to avoid transparent-window flicker.
      ...(process.platform === 'win32'
        ? {
            opacity: 0,
            roundedCorners: false,
            thickFrame: false,
            backgroundMaterial: 'none' as const
          }
        : {}),
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      acceptFirstMouse: true,
      ...(process.platform === 'darwin'
        ? { type: 'panel' as const, hiddenInMissionControl: true }
        : {}),
      skipTaskbar: true,
      alwaysOnTop: true,
      // Windows DWM can add a thin non-client border without producing a useful
      // shadow for transparent frameless windows. CSS owns that shadow instead.
      hasShadow: process.platform !== 'win32',
      webPreferences: {
        preload: resolvePreloadPath('selection-toolbar.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    applySelectionWindowBehavior(window)
    this.ensureActiveSpaceSubscription()
    window.on('closed', () => {
      if (this.selectionToolbarWindow === window) this.selectionToolbarWindow = undefined
    })
    this.selectionToolbarWindow = window
    return window
  }

  createSelectionExplanationWindow(): BrowserWindow {
    if (this.selectionExplanationWindow && !this.selectionExplanationWindow.isDestroyed()) {
      return this.selectionExplanationWindow
    }

    const darkMode = nativeTheme.shouldUseDarkColors
    const window = new BrowserWindow({
      width: 520,
      height: 600,
      minWidth: 360,
      minHeight: 300,
      show: false,
      frame: false,
      backgroundColor: darkMode ? '#212121' : '#faf9f7',
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      ...(process.platform === 'darwin'
        ? { type: 'panel' as const, hiddenInMissionControl: true }
        : {}),
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: resolvePreloadPath('selection-explanation.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    applySelectionWindowBehavior(window)
    this.ensureActiveSpaceSubscription()

    const view = new WebContentsViewManager(window, {
      backgroundColor: darkMode ? '#212121' : '#ffffff',
      view: {
        webPreferences: {
          partition: DICTIONARY_SESSION_PARTITION,
          preload: resolvePreloadPath('selection-entry.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          // Keep this aligned with dictionaryView so file: resources use the same
          // dedicated-session protocol handler in selection explanations.
          webSecurity: false
        }
      }
    })
    const updateViewBounds = (): void => {
      const [width, height] = window.getContentSize()
      // Keep the native view below the renderer-owned divider instead of sharing its edge pixel.
      const viewTop =
        SELECTION_EXPLANATION_HEADER_HEIGHT +
        (this.selectionExplanationSwitcherVisible
          ? SELECTION_EXPLANATION_DICTIONARY_SWITCHER_HEIGHT + 1
          : 0)
      view.setBounds({
        x: 1,
        y: viewTop,
        width: Math.max(0, width - 2),
        height: Math.max(0, height - viewTop - 1)
      })
    }
    this.updateSelectionExplanationViewBounds = updateViewBounds
    window.on('resize', updateViewBounds)
    window.on('closed', () => {
      view.dispose()
      this.selectionExplanationSwitcherVisible = false
      this.updateSelectionExplanationViewBounds = undefined
      if (this.selectionExplanationView === view) this.selectionExplanationView = undefined
      if (this.selectionExplanationWindow === window) this.selectionExplanationWindow = undefined
    })
    updateViewBounds()

    this.selectionExplanationWindow = window
    this.selectionExplanationView = view
    return window
  }

  createCustomCssEditorWindow(): BrowserWindow {
    if (this.customCssEditorWindow && !this.customCssEditorWindow.isDestroyed()) {
      return this.customCssEditorWindow
    }

    const darkMode = nativeTheme.shouldUseDarkColors
    const window = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 900,
      minHeight: 560,
      show: false,
      backgroundColor: darkMode ? '#212121' : '#faf9f7',
      autoHideMenuBar: true,
      webPreferences: {
        preload: resolvePreloadPath('custom-css-editor.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    const previewView = new WebContentsViewManager(window, {
      backgroundColor: darkMode ? '#212121' : '#ffffff',
      view: {
        webPreferences: {
          partition: DICTIONARY_SESSION_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: false
        }
      }
    })
    window.on('closed', () => {
      previewView.dispose()
      if (this.customCssEditorPreviewView === previewView) {
        this.customCssEditorPreviewView = undefined
      }
      if (this.customCssEditorWindow === window) this.customCssEditorWindow = undefined
    })

    this.customCssEditorWindow = window
    this.customCssEditorPreviewView = previewView
    return window
  }

  setSelectionExplanationSwitcherVisible(visible: boolean): void {
    if (this.selectionExplanationSwitcherVisible === visible) return
    this.selectionExplanationSwitcherVisible = visible
    this.updateSelectionExplanationViewBounds?.()
  }

  focusMainWindowRenderer(): void {
    const mainWindow = this.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

    if (!mainWindow.isFocused()) mainWindow.focus()
    mainWindow.webContents.focus()
  }

  dispose(): void {
    if (this.observingNativeAppearance) {
      nativeTheme.off('updated', this.updateNativeAppearance)
      this.observingNativeAppearance = false
    }
    if (this.activeSpaceSubscriptionId !== undefined) {
      systemPreferences.unsubscribeWorkspaceNotification(this.activeSpaceSubscriptionId)
      this.activeSpaceSubscriptionId = undefined
    }
    this.dictionaryView?.dispose()
    this.embedBrowserView?.dispose()
    this.searchPopoverView?.dispose()
    this.selectionExplanationView?.dispose()
    this.findBarView?.dispose()
    this.customCssEditorPreviewView?.dispose()
    if (this.selectionToolbarWindow && !this.selectionToolbarWindow.isDestroyed()) {
      this.selectionToolbarWindow.destroy()
    }
    if (this.selectionExplanationWindow && !this.selectionExplanationWindow.isDestroyed()) {
      this.selectionExplanationWindow.destroy()
    }
    if (this.customCssEditorWindow && !this.customCssEditorWindow.isDestroyed()) {
      this.customCssEditorWindow.destroy()
    }

    this.dictionaryView = undefined
    this.embedBrowserView = undefined
    this.searchPopoverView = undefined
    this.selectionToolbarWindow = undefined
    this.selectionExplanationWindow = undefined
    this.selectionExplanationView = undefined
    this.selectionExplanationSwitcherVisible = false
    this.updateSelectionExplanationViewBounds = undefined
    this.findBarView = undefined
    this.customCssEditorWindow = undefined
    this.customCssEditorPreviewView = undefined
    this.mainWindow = undefined
  }

  private requireMainWindow(): BrowserWindow {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      throw new Error('创建 WebContentsView 前必须先创建主窗口')
    }

    return this.mainWindow
  }

  private ensureActiveSpaceSubscription(): void {
    if (process.platform !== 'darwin' || this.activeSpaceSubscriptionId !== undefined) return

    this.activeSpaceSubscriptionId = systemPreferences.subscribeWorkspaceNotification(
      'NSWorkspaceActiveSpaceDidChangeNotification',
      () => {
        hideSelectionWindow(this.selectionToolbarWindow)
        hideSelectionWindow(this.selectionExplanationWindow)
      }
    )
  }

  private readonly updateNativeAppearance = (): void => {
    const useDarkColors = nativeTheme.shouldUseDarkColors
    const window = this.mainWindow
    if (!window || window.isDestroyed()) return
    window.setBackgroundColor(getMainWindowBackgroundColor(useDarkColors))

    if (this.dictionaryView && !this.dictionaryView.isDestroyed) {
      this.dictionaryView.setBackgroundColor(useDarkColors ? '#212121' : '#ffffff')
    }

    const explanationWindow = this.selectionExplanationWindow
    if (explanationWindow && !explanationWindow.isDestroyed()) {
      explanationWindow.setBackgroundColor(useDarkColors ? '#171a18' : '#faf9f7')
    }
    if (this.selectionExplanationView && !this.selectionExplanationView.isDestroyed) {
      this.selectionExplanationView.setBackgroundColor(useDarkColors ? '#171a18' : '#ffffff')
    }
    const customCssEditorWindow = this.customCssEditorWindow
    if (customCssEditorWindow && !customCssEditorWindow.isDestroyed()) {
      customCssEditorWindow.setBackgroundColor(useDarkColors ? '#171a18' : '#faf9f7')
    }
    if (process.platform === 'win32') {
      window.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: useDarkColors ? '#dddeda' : '#534f48',
        height: MAIN_WINDOW_TITLEBAR_HEIGHT
      })
    }
  }
}
