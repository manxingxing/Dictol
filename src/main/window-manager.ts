import { BrowserWindow, Menu, nativeTheme, screen, type Rectangle } from 'electron'

import icon from '../../resources/icon.png?asset'
import {
  SELECTION_EXPLANATION_DICTIONARY_SWITCHER_HEIGHT,
  SELECTION_EXPLANATION_HEADER_HEIGHT
} from '../shared/selection-explanation'
import { getSelectionToolbarWindowSize } from '../shared/selection-toolbar'
import {
  SELECTION_TRANSLATION_INITIAL_HEIGHT,
  SELECTION_TRANSLATION_MAX_HEIGHT,
  SELECTION_TRANSLATION_WIDTH
} from '../shared/translation'
import { MAIN_WINDOW_TITLEBAR_HEIGHT } from '../shared/window-chrome'
import { DICTIONARY_SESSION_PARTITION, EMBED_BROWSER_SESSION_PARTITION } from './entry-assets'
import { resolvePreloadPath } from './output-path'
import { applySelectionWindowBehavior } from './selection-window-behavior'
import { WebContentsViewManager } from './web-contents-view-manager'
import { NativeSelectionPanel } from './native-selection-panel'
import { configureElectronPanel } from '@dictol/mdict-native'

export type SelectionSurfaceWindow = BrowserWindow | NativeSelectionPanel

const getMainWindowBackgroundColor = (useDarkColors: boolean): string =>
  process.platform === 'darwin' ? '#00000000' : useDarkColors ? '#232323' : '#faf9f7'

const ocrHighlightPage = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}
#highlight{position:fixed;inset:0;border-bottom:2px solid rgba(187,126,0,.95);background:rgba(255,193,7,.42)}
</style></head><body><div id="highlight"></div></body></html>`)}`

export class WindowManager {
  mainWindow: BrowserWindow | undefined
  dictionaryView: WebContentsViewManager | undefined
  aggregateDictionaryView: WebContentsViewManager | undefined
  readonly embedBrowserViews = new Map<string, WebContentsViewManager>()
  searchPopoverView: WebContentsViewManager | undefined
  selectionToolbarWindow: SelectionSurfaceWindow | undefined
  selectionExplanationWindow: SelectionSurfaceWindow | undefined
  private ocrHighlightWindow: BrowserWindow | undefined
  private ocrHighlightReady = false
  private ocrHighlightRequested = false
  private ocrHighlightBounds: Rectangle | undefined
  private ocrHighlightVersion = 0
  readonly excerptCaptureWindows = new Set<BrowserWindow>()
  selectionTranslationWindow: BrowserWindow | undefined
  selectionExplanationView: WebContentsViewManager | undefined
  findBarView: WebContentsViewManager | undefined
  customCssEditorWindow: BrowserWindow | undefined
  browseWindow: BrowserWindow | undefined
  private browseDictionaryId: number | undefined
  customCssEditorPreviewView: WebContentsViewManager | undefined
  private observingNativeAppearance = false
  private selectionExplanationSwitcherVisible = false
  private selectionExplanationPinned = false
  private updateSelectionExplanationViewBounds: (() => void) | undefined

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow

    this.dictionaryView?.dispose()
    this.aggregateDictionaryView?.dispose()
    this.disposeEmbedBrowserViews()
    this.searchPopoverView?.dispose()
    this.findBarView?.dispose()
    this.dictionaryView = undefined
    this.aggregateDictionaryView = undefined
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
            visualEffectState: 'followWindow' as const
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

    const notifyWindowFocusChanged = (isFocused: boolean): void => {
      if (mainWindow.webContents.isDestroyed()) return
      mainWindow.webContents.send('app:main-window-focus-changed', isFocused)
    }
    mainWindow.on('focus', () => notifyWindowFocusChanged(true))
    mainWindow.on('blur', () => notifyWindowFocusChanged(false))

    mainWindow.webContents.on('context-menu', (_event, params) => {
      if (!params.isEditable && !params.selectionText.trim()) return
      const menu = Menu.buildFromTemplate(
        params.isEditable
          ? [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }]
          : [{ role: 'copy' }]
      )
      menu.popup({
        window: mainWindow,
        ...(params.frame ? { frame: params.frame } : {})
      })
    })

    if (!this.observingNativeAppearance) {
      nativeTheme.on('updated', this.updateNativeAppearance)
      this.observingNativeAppearance = true
    }
    this.mainWindow = mainWindow
    mainWindow.on('closed', () => {
      if (this.mainWindow === mainWindow) {
        this.mainWindow = undefined
        this.disposeEmbedBrowserViews()
      }
    })
    return mainWindow
  }

  createDictionaryView(): WebContentsViewManager {
    if (this.dictionaryView && !this.dictionaryView.isDestroyed) {
      return this.dictionaryView
    }

    const dictionaryView = this.createDictionaryEntryView()
    this.dictionaryView = dictionaryView
    return dictionaryView
  }

  createAggregateDictionaryView(): WebContentsViewManager {
    if (this.aggregateDictionaryView && !this.aggregateDictionaryView.isDestroyed) {
      return this.aggregateDictionaryView
    }

    const aggregateDictionaryView = this.createDictionaryEntryView()
    this.aggregateDictionaryView = aggregateDictionaryView
    return aggregateDictionaryView
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

  createEmbedBrowserView(tabId: string): WebContentsViewManager {
    const existing = this.embedBrowserViews.get(tabId)
    if (existing && !existing.isDestroyed) {
      return existing
    }

    const mainWindow = this.requireMainWindow()
    const embedBrowserView = new WebContentsViewManager(mainWindow, {
      view: {
        webPreferences: {
          partition: EMBED_BROWSER_SESSION_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true
        }
      }
    })

    this.embedBrowserViews.set(tabId, embedBrowserView)
    return embedBrowserView
  }

  closeEmbedBrowserView(tabId: string): boolean {
    const view = this.embedBrowserViews.get(tabId)
    if (!view) return false
    this.embedBrowserViews.delete(tabId)
    view.dispose()
    return true
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

  createSelectionToolbarWindow(): SelectionSurfaceWindow {
    if (this.selectionToolbarWindow && !this.selectionToolbarWindow.isDestroyed()) {
      return this.selectionToolbarWindow
    }

    const initialSize = getSelectionToolbarWindowSize(process.platform)
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
      // On macOS the visible native surface is Electron's panel window; the
      // hidden BrowserWindow only owns Chromium's renderer tree.
      focusable: true,
      acceptFirstMouse: true,
      // `type: 'panel'` is deliberately avoided because Electron forces
      // `CanJoinAllSpaces` on that window type. macOS presents the renderer in
      // a separate AppKit NSPanel created below.
      skipTaskbar: true,
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
    const surface: SelectionSurfaceWindow =
      process.platform === 'darwin'
        ? new NativeSelectionPanel(window, 'toolbar', { resizable: false, movable: false })
        : window
    if (!(surface instanceof NativeSelectionPanel)) applySelectionWindowBehavior(surface)
    surface.on('closed', () => {
      if (this.selectionToolbarWindow === surface) this.selectionToolbarWindow = undefined
    })
    this.selectionToolbarWindow = surface
    return surface
  }

  createSelectionExplanationWindow(): SelectionSurfaceWindow {
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
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      backgroundColor: darkMode ? '#232323' : '#faf9f7',
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      acceptFirstMouse: true,
      skipTaskbar: true,
      webPreferences: {
        preload: resolvePreloadPath('selection-explanation.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    if (process.platform === 'darwin') {
      // Keep Chromium's content view in its owning Electron window. Electron's
      // panel type is non-activating, but its collection behavior joins Spaces;
      // the native bridge changes that policy on this Electron panel instance only.
      configureElectronPanel(window.getNativeWindowHandle())
    }
    const view = new WebContentsViewManager(window, {
      backgroundColor: darkMode ? '#232323' : '#ffffff',
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
    const surface: SelectionSurfaceWindow = window
    if (process.platform !== 'darwin') applySelectionWindowBehavior(window)
    const updateViewBounds = (): void => {
      const [width, height] = surface.getContentSize()
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
    surface.on('resize', updateViewBounds)
    surface.on('closed', () => {
      view.dispose()
      this.selectionExplanationSwitcherVisible = false
      this.updateSelectionExplanationViewBounds = undefined
      if (this.selectionExplanationView === view) this.selectionExplanationView = undefined
      if (this.selectionExplanationWindow === surface) this.selectionExplanationWindow = undefined
    })
    updateViewBounds()

    this.selectionExplanationWindow = surface
    this.selectionExplanationView = view
    return surface
  }

  showOcrHighlight(bounds: Rectangle): void {
    let window = this.ocrHighlightWindow
    this.ocrHighlightRequested = true
    this.ocrHighlightBounds = bounds
    const version = ++this.ocrHighlightVersion
    // Windows can enforce a minimum size even for a frameless window. Keep the
    // surface transparent and position the painted rectangle independently.
    const windowBounds =
      process.platform === 'win32'
        ? {
            x: bounds.x,
            y: bounds.y - Math.floor((Math.max(64, bounds.height) - bounds.height) / 2),
            width: Math.max(64, bounds.width),
            height: Math.max(64, bounds.height)
          }
        : bounds
    if (!window || window.isDestroyed()) {
      this.ocrHighlightReady = false
      const highlightWindow = new BrowserWindow({
        ...windowBounds,
        show: false,
        frame: false,
        type: process.platform === 'darwin' ? 'panel' : undefined,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        focusable: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
      })
      window = highlightWindow
      this.ocrHighlightWindow = highlightWindow
      highlightWindow.setIgnoreMouseEvents(true)
      void highlightWindow
        .loadURL(ocrHighlightPage)
        .then(() => {
          if (this.ocrHighlightWindow !== highlightWindow || highlightWindow.isDestroyed()) return
          this.ocrHighlightReady = true
          if (this.ocrHighlightRequested && this.ocrHighlightBounds) {
            void this.paintOcrHighlight(
              highlightWindow,
              this.ocrHighlightBounds,
              this.ocrHighlightVersion
            )
          }
        })
        .catch((error: unknown) => {
          console.error('Failed to load OCR highlight surface', error)
          if (this.ocrHighlightWindow === highlightWindow) {
            this.ocrHighlightReady = false
            this.ocrHighlightRequested = false
          }
        })
      if (process.platform === 'darwin') {
        highlightWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true
        })
      }
      highlightWindow.on('closed', () => {
        if (this.ocrHighlightWindow === highlightWindow) {
          this.ocrHighlightWindow = undefined
          this.ocrHighlightReady = false
          this.ocrHighlightRequested = false
          this.ocrHighlightBounds = undefined
        }
      })
    }
    window.hide()
    window.setBounds(windowBounds, false)
    if (this.ocrHighlightReady) void this.paintOcrHighlight(window, bounds, version)
  }

  private async paintOcrHighlight(
    window: BrowserWindow,
    bounds: Rectangle,
    version: number
  ): Promise<void> {
    const content = window.getContentBounds()
    const height =
      process.platform === 'win32'
        ? Math.min(bounds.height, Math.max(12, Math.round(bounds.height * 0.8)))
        : bounds.height
    const painted = {
      x: bounds.x - content.x,
      y: bounds.y + Math.floor((bounds.height - height) / 2) - content.y,
      width: bounds.width,
      height
    }
    try {
      const cssText = `left:${painted.x}px;top:${painted.y}px;right:auto;bottom:auto;width:${painted.width}px;height:${painted.height}px`
      const painting = window.webContents.executeJavaScript(
        `(() => { const element = document.getElementById('highlight'); if (!element) return false; element.style.cssText = ${JSON.stringify(cssText)}; return true })()`
      )
      if (
        this.ocrHighlightWindow === window &&
        !window.isDestroyed() &&
        this.ocrHighlightRequested &&
        this.ocrHighlightVersion === version
      ) {
        window.showInactive()
      }
      if (!(await painting)) throw new Error('OCR highlight element is missing')
    } catch (error) {
      console.error('Failed to paint OCR highlight', error)
      if (
        this.ocrHighlightWindow === window &&
        !window.isDestroyed() &&
        this.ocrHighlightRequested &&
        this.ocrHighlightVersion === version
      ) {
        window.showInactive()
      }
    }
  }

  hideOcrHighlight(): void {
    this.ocrHighlightRequested = false
    this.ocrHighlightBounds = undefined
    ++this.ocrHighlightVersion
    const window = this.ocrHighlightWindow
    if (window && !window.isDestroyed()) window.hide()
  }

  createExcerptCaptureWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: 520,
      height: 600,
      minWidth: 420,
      minHeight: 360,
      show: false,
      title: '摘抄与笔记',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#232323' : '#faf9f7',
      autoHideMenuBar: true,
      webPreferences: {
        preload: resolvePreloadPath('external-excerpt.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.excerptCaptureWindows.add(window)
    window.on('closed', () => this.excerptCaptureWindows.delete(window))
    return window
  }

  createSelectionTranslationWindow(): BrowserWindow {
    if (this.selectionTranslationWindow && !this.selectionTranslationWindow.isDestroyed()) {
      return this.selectionTranslationWindow
    }
    const window = new BrowserWindow({
      width: SELECTION_TRANSLATION_WIDTH,
      height: SELECTION_TRANSLATION_INITIAL_HEIGHT,
      minHeight: SELECTION_TRANSLATION_INITIAL_HEIGHT,
      maxHeight: SELECTION_TRANSLATION_MAX_HEIGHT,
      show: false,
      frame: false,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#232323' : '#faf9f7',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      acceptFirstMouse: true,
      skipTaskbar: true,
      webPreferences: {
        preload: resolvePreloadPath('selection-translation.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    if (process.platform === 'darwin') configureElectronPanel(window.getNativeWindowHandle())
    else applySelectionWindowBehavior(window)
    window.on('closed', () => {
      if (this.selectionTranslationWindow === window) this.selectionTranslationWindow = undefined
    })
    this.selectionTranslationWindow = window
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
      backgroundColor: darkMode ? '#232323' : '#faf9f7',
      autoHideMenuBar: true,
      webPreferences: {
        preload: resolvePreloadPath('custom-css-editor.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    const previewView = new WebContentsViewManager(window, {
      backgroundColor: darkMode ? '#232323' : '#ffffff',
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

  createBrowseWindow(mainWindow: BrowserWindow, dictionaryId: number): BrowserWindow {
    if (this.browseWindow && !this.browseWindow.isDestroyed()) {
      this.browseDictionaryId = dictionaryId
      return this.browseWindow
    }

    const mainBounds = mainWindow.getBounds()
    const display = screen.getDisplayMatching(mainBounds)
    const {
      x: workAreaX,
      y: workAreaY,
      width: workAreaWidth,
      height: workAreaHeight
    } = display.workArea
    const width = 350
    const gap = 8
    const height = Math.min(mainBounds.height, workAreaHeight)
    const rightX = mainBounds.x + mainBounds.width + gap
    const leftX = mainBounds.x - width - gap
    const x =
      rightX + width <= workAreaX + workAreaWidth
        ? rightX
        : Math.max(workAreaX, Math.min(leftX, workAreaX + workAreaWidth - width))
    const y = Math.max(workAreaY, Math.min(mainBounds.y, workAreaY + workAreaHeight - height))

    const window = new BrowserWindow({
      x,
      y,
      width,
      height,
      minWidth: 300,
      minHeight: 420,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#232323' : '#fdfdfb',
      autoHideMenuBar: true,
      webPreferences: {
        preload: resolvePreloadPath('browse.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    window.on('closed', () => {
      if (this.browseWindow === window) {
        this.browseWindow = undefined
        this.browseDictionaryId = undefined
      }
    })
    this.browseWindow = window
    this.browseDictionaryId = dictionaryId
    return window
  }

  closeBrowseWindowForDictionary(dictionaryId: number): void {
    if (this.browseDictionaryId !== dictionaryId) return
    if (this.browseWindow && !this.browseWindow.isDestroyed()) this.browseWindow.destroy()
    this.browseWindow = undefined
    this.browseDictionaryId = undefined
  }

  setSelectionExplanationSwitcherVisible(visible: boolean): void {
    if (this.selectionExplanationSwitcherVisible === visible) return
    this.selectionExplanationSwitcherVisible = visible
    this.updateSelectionExplanationViewBounds?.()
  }

  isSelectionExplanationPinned(): boolean {
    return this.selectionExplanationPinned
  }

  hasVisibleSelectionSurface(): boolean {
    return [
      this.selectionToolbarWindow,
      this.selectionExplanationWindow,
      this.selectionTranslationWindow,
      ...this.excerptCaptureWindows
    ].some((window) => window && !window.isDestroyed() && window.isVisible())
  }

  toggleSelectionExplanationPinned(): boolean {
    this.selectionExplanationPinned = !this.selectionExplanationPinned
    return this.selectionExplanationPinned
  }

  resetSelectionExplanationPinned(): void {
    this.selectionExplanationPinned = false
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
    this.dictionaryView?.dispose()
    this.aggregateDictionaryView?.dispose()
    this.disposeEmbedBrowserViews()
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
    if (this.ocrHighlightWindow && !this.ocrHighlightWindow.isDestroyed()) {
      this.ocrHighlightWindow.destroy()
    }
    this.excerptCaptureWindows.forEach((window) => {
      if (!window.isDestroyed()) window.destroy()
    })
    if (this.selectionTranslationWindow && !this.selectionTranslationWindow.isDestroyed()) {
      this.selectionTranslationWindow.destroy()
    }
    if (this.customCssEditorWindow && !this.customCssEditorWindow.isDestroyed()) {
      this.customCssEditorWindow.destroy()
    }
    if (this.browseWindow && !this.browseWindow.isDestroyed()) {
      this.browseWindow.destroy()
    }

    this.dictionaryView = undefined
    this.aggregateDictionaryView = undefined
    this.searchPopoverView = undefined
    this.selectionToolbarWindow = undefined
    this.selectionExplanationWindow = undefined
    this.ocrHighlightWindow = undefined
    this.ocrHighlightReady = false
    this.ocrHighlightRequested = false
    this.excerptCaptureWindows.clear()
    this.selectionTranslationWindow = undefined
    this.selectionExplanationView = undefined
    this.selectionExplanationSwitcherVisible = false
    this.selectionExplanationPinned = false
    this.updateSelectionExplanationViewBounds = undefined
    this.findBarView = undefined
    this.customCssEditorWindow = undefined
    this.customCssEditorPreviewView = undefined
    this.browseWindow = undefined
    this.browseDictionaryId = undefined
    this.mainWindow = undefined
  }

  private requireMainWindow(): BrowserWindow {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      throw new Error('创建 WebContentsView 前必须先创建主窗口')
    }

    return this.mainWindow
  }

  private disposeEmbedBrowserViews(): void {
    for (const view of this.embedBrowserViews.values()) view.dispose()
    this.embedBrowserViews.clear()
  }

  private createDictionaryEntryView(): WebContentsViewManager {
    const mainWindow = this.requireMainWindow()
    return new WebContentsViewManager(mainWindow, {
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#232323' : '#ffffff',
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
  }

  private readonly updateNativeAppearance = (): void => {
    const useDarkColors = nativeTheme.shouldUseDarkColors
    const window = this.mainWindow
    if (window && !window.isDestroyed()) {
      window.setBackgroundColor(getMainWindowBackgroundColor(useDarkColors))
    }

    if (this.dictionaryView && !this.dictionaryView.isDestroyed) {
      this.dictionaryView.setBackgroundColor(useDarkColors ? '#232323' : '#ffffff')
    }
    if (this.aggregateDictionaryView && !this.aggregateDictionaryView.isDestroyed) {
      this.aggregateDictionaryView.setBackgroundColor(useDarkColors ? '#232323' : '#ffffff')
    }

    const explanationWindow = this.selectionExplanationWindow
    if (explanationWindow && !explanationWindow.isDestroyed()) {
      explanationWindow.setBackgroundColor(useDarkColors ? '#232323' : '#faf9f7')
    }
    if (this.selectionExplanationView && !this.selectionExplanationView.isDestroyed) {
      this.selectionExplanationView.setBackgroundColor(useDarkColors ? '#232323' : '#ffffff')
    }
    const customCssEditorWindow = this.customCssEditorWindow
    if (customCssEditorWindow && !customCssEditorWindow.isDestroyed()) {
      customCssEditorWindow.setBackgroundColor(useDarkColors ? '#232323' : '#faf9f7')
    }
    if (this.customCssEditorPreviewView && !this.customCssEditorPreviewView.isDestroyed) {
      this.customCssEditorPreviewView.setBackgroundColor(useDarkColors ? '#232323' : '#ffffff')
    }
    const browseWindow = this.browseWindow
    if (browseWindow && !browseWindow.isDestroyed()) {
      browseWindow.setBackgroundColor(useDarkColors ? '#232323' : '#fdfdfb')
    }
    if (window && !window.isDestroyed() && process.platform === 'win32') {
      window.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: useDarkColors ? '#dddeda' : '#534f48',
        height: MAIN_WINDOW_TITLEBAR_HEIGHT
      })
    }
  }
}
