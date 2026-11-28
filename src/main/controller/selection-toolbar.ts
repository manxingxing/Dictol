import {
  clipboard,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Point,
  type WebContents
} from 'electron'
import type { AppRuntime } from '../app-runtime'
import {
  getSelectionToolbarWindowSize,
  SELECTION_TOOLBAR_WINDOWS_SHADOW_MARGIN,
  type ExternalExcerptCapture,
  type SelectionToolbarPayload
} from '../../shared/selection-toolbar'
import { SELECTION_EXPLANATION_MAX_WORD_LENGTH } from '../../shared/selection-explanation'
import type {
  CapturedSelection,
  KeyDownListener,
  MouseDownListener,
  MouseWheelListener,
  SelectionListener
} from '../selection-hook-service'
import { resolveRendererUrl } from '../output-path'
import { hideSelectionWindow, showSelectionWindowInactive } from '../selection-window-behavior'
import { NativeSelectionPanel } from '../native-selection-panel'
import type { SelectionSurfaceWindow } from '../window-manager'
import { BaseController } from './base-controller'
import type { SelectionExplanationAction } from '../action/selection-explanation'
import type { TranslationController } from './translation'
import { TRANSLATION_MAX_TEXT_LENGTH } from '../../shared/translation'
import {
  clamp,
  containsPoint,
  createCursorAnchor,
  fitNearSelection,
  fitTranslationNearSelection,
  insetRectangle,
  toDisplayAnchor,
  toDisplayPoint,
  type SelectionAnchor
} from '../lib/selection-position'

const NATIVE_MENU_GAP = 6
const TOOLBAR_INACTIVITY_TIMEOUT = 5_000
export class SelectionToolbarController extends BaseController {
  constructor(
    runtime: AppRuntime,
    private readonly translation: TranslationController
  ) {
    super(runtime)
  }

  private currentCapture: CapturedSelection | undefined
  private pendingToolbarCapture: CapturedSelection | undefined
  private anchor: SelectionAnchor | undefined
  private toolbarWebContentsId: number | undefined
  private toolbarLoaded = false
  // Windows keeps the transparent native window shown at zero opacity to avoid
  // DWM flicker, so native isVisible() is not the toolbar's logical visibility.
  private toolbarVisible = false
  private toolbarRenderRequestId = 0
  private pendingToolbarRenderRequestId: number | undefined
  private inactivityTimer: ReturnType<typeof setTimeout> | undefined
  private nativeMenu: Menu | undefined
  private nativeMenuOpen = false
  private toolbarDismissSubscriptions: Array<() => void> = []
  private globalMouseDownUnsubscribe: (() => void) | undefined

  private get explanation(): SelectionExplanationAction {
    return this.runtime.actions.explanation
  }

  override mount(): void {
    this.explanation.setOnVisibilityChange(this.refreshDismissSubscription)
    this.explanation.setOnCursorLookup(() => {
      this.currentCapture = undefined
      this.hideToolbar()
    })
    this.translation.setOnVisibilityChange(this.refreshDismissSubscription)
    this.runtime.selectionHookService.onSelection(this.handleSelection)
    ipcMain.on('selection-toolbar:lookup-in-main', this.lookupInMain)
    ipcMain.on('selection-toolbar:explain', this.explain)
    ipcMain.on('selection-toolbar:translate', this.translate)
    ipcMain.handle('selection-toolbar:copy', this.copy)
    ipcMain.on('selection-toolbar:open-menu', this.openNativeMenu)
    ipcMain.on('selection-toolbar:activity', this.handleToolbarActivity)
    ipcMain.on('selection-toolbar:rendered', this.handleToolbarRendered)
    ipcMain.on('selection-translation:close', this.closeTranslation)
    ipcMain.handle('selection-toolbar:capture-excerpt', this.captureExcerpt)
  }

  private readonly closeTranslation = (event: IpcMainEvent): void => {
    if (this.acceptsTranslationSender(event)) this.translation.hide()
  }

  private readonly handleSelection: SelectionListener = (capture): void => {
    const word = capture.selection.text.trim()
    if (!word) return

    if (capture.source === 'shortcut') {
      this.currentCapture = capture
      this.anchor = toDisplayAnchor(capture)
      this.explanation.setAnchor(this.anchor, { animate: false })
      this.hideToolbar()
      void this.explanation.showExplanation(word)
      return
    }
    // 在应用内部选择文本，不触发toolbar
    if (
      capture.source !== 'selection' ||
      BrowserWindow.getFocusedWindow() ||
      this.hasFocusedSelectionWindow()
    ) {
      return
    }

    this.currentCapture = capture
    this.pendingToolbarCapture = capture
    this.anchor = toDisplayAnchor(capture)
    this.explanation.setAnchor(this.anchor, { animate: false })

    const window = this.initializeToolbarWindow()
    const toolbarSize = this.syncToolbarSize(window)
    this.positionToolbar(window, toolbarSize)
    if (this.toolbarLoaded) this.showPendingToolbar(window)
    this.explanation.prewarmExplanationWindow()
  }

  private readonly handleGlobalMouseDown: MouseDownListener = (event): void => {
    if (this.nativeMenu || this.nativeMenuOpen) return
    const point = toDisplayPoint(event)
    this.hideSelectionWindowsOutside(point)
  }

  private readonly handleGlobalKeyDown: KeyDownListener = (): void => {
    if (this.nativeMenu || this.nativeMenuOpen) return
    this.hideToolbar()
  }

  private readonly handleMouseWheel: MouseWheelListener = (): void => {
    // Keep the explanation document scrollable. Only the short-lived selection
    // toolbar is dismissed by a global scroll gesture.
    this.hideToolbar()
  }

  private readonly explain = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event) || !this.currentCapture) return
    const word = this.currentCapture.selection.text.trim()
    this.hideToolbar()
    void this.explanation.showExplanation(word)
  }

  private readonly translate = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event) || !this.currentCapture) return
    const text = this.currentCapture.selection.text.trim()
    if (!text || text.length > TRANSLATION_MAX_TEXT_LENGTH) return
    const position = fitTranslationNearSelection(this.currentCapture.selection)
    this.hideToolbar()
    this.translation.showSelection(text, position)
  }

  private readonly lookupInMain = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event)) return
    const word = this.currentCapture?.selection.text.trim()
    if (!word || word.length > SELECTION_EXPLANATION_MAX_WORD_LENGTH) return

    this.hideToolbar({ activateMainWindow: true })
    this.runtime.lookupSelectionInMainWindow(word)
  }

  private readonly copy = async (event: IpcMainInvokeEvent): Promise<void> => {
    if (!this.acceptsToolbarSender(event)) return
    const word = this.currentCapture?.selection.text.trim()
    if (!word) return
    await clipboard.writeText(word)
    this.hideToolbar()
  }

  private readonly captureExcerpt = (event: IpcMainInvokeEvent): void => {
    if (!this.acceptsToolbarSender(event) || !this.currentCapture) return
    const text = this.currentCapture.selection.text
    if (!text.trim() || text.length > 100_000) return
    const sourceApp = this.currentCapture.selection.programName.trim()

    try {
      this.openExcerptCapture({
        text,
        sourceApp,
        aiEnabled: this.runtime.appConfig.load().aiLookup.enabled
      })
      this.hideToolbar()
    } catch (error) {
      console.error('Failed to open excerpt capture', error)
      this.notifyExcerptCaptureError(error instanceof Error ? error.message : '无法打开摘抄窗口')
    }
  }

  private openExcerptCapture(payload: ExternalExcerptCapture): void {
    const window = this.runtime.windowManager.createExcerptCaptureWindow()
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    void window
      .loadURL(resolveRendererUrl('external-excerpt.html'))
      .then(() => {
        if (window.isDestroyed()) return
        window.webContents.send('external-excerpt:update', payload)
        window.show()
        window.focus()
      })
      .catch((error: unknown) => {
        console.error('Failed to load excerpt capture', error)
        if (!window.isDestroyed()) window.close()
        this.notifyExcerptCaptureError('无法打开摘抄窗口')
      })
  }

  private notifyExcerptCaptureError(message: string): void {
    const mainWindow = this.runtime.mainWindow
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.webContents.send('notification:toast', { type: 'error', message })
      return
    }
    new Notification({ title: '摘抄窗口无法打开', body: message }).show()
  }

  private excludeProgram(programName: string): void {
    if (!programName) return

    try {
      this.runtime.appConfig.addExcludedProgram(programName)
      this.runtime.restartInputServices()
    } catch (error) {
      console.error('Failed to exclude program from selection lookup', { programName, error })
    }
  }

  private readonly openNativeMenu = (event: IpcMainEvent): void => {
    if (
      !this.acceptsToolbarSender(event) ||
      !this.currentCapture ||
      this.nativeMenu ||
      this.nativeMenuOpen
    )
      return
    const surface = this.currentToolbarWindow
    if (!surface) return

    const programName = this.currentCapture.selection.programName.trim()
    this.clearToolbarAutoHide()

    if (surface instanceof NativeSelectionPanel) {
      this.nativeMenuOpen = true
      try {
        if (surface.showDisableSelectionMenu(Boolean(programName))) {
          this.excludeProgram(programName)
        }
      } catch (error) {
        console.error('Failed to show selection toolbar native menu', error)
      } finally {
        this.nativeMenuOpen = false
        this.hideToolbar()
      }
      return
    }

    const menu = Menu.buildFromTemplate([
      {
        label: '在此应用禁用划词',
        enabled: Boolean(programName),
        click: () => this.excludeProgram(programName)
      }
    ])
    this.nativeMenu = menu
    const cursorPoint = screen.getCursorScreenPoint()
    const toolbarBounds = surface.getBounds()
    const toolbarShadowMargin = getToolbarShadowMargin()

    try {
      menu.popup({
        window: surface,
        x: clamp(cursorPoint.x - toolbarBounds.x - 6, 0, toolbarBounds.width),
        y: toolbarBounds.height - toolbarShadowMargin + NATIVE_MENU_GAP,
        callback: () => {
          if (this.nativeMenu === menu) this.nativeMenu = undefined
          this.hideToolbar()
        }
      })
    } catch (error) {
      this.nativeMenu = undefined
      this.scheduleToolbarAutoHide()
      console.error('Failed to show selection toolbar native menu', error)
    }
  }

  // 无活动时，自动隐藏toolbar
  private readonly handleToolbarActivity = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event) || !this.toolbarVisible) return
    this.scheduleToolbarAutoHide()
  }

  private readonly handleToolbarRendered = (event: IpcMainEvent, requestId: number): void => {
    if (
      process.platform !== 'win32' ||
      !this.acceptsToolbarSender(event) ||
      !Number.isSafeInteger(requestId) ||
      requestId !== this.pendingToolbarRenderRequestId
    ) {
      return
    }

    const window = this.currentToolbarWindow
    if (!window) return
    this.pendingToolbarRenderRequestId = undefined
    window.setIgnoreMouseEvents(false)
    window.setOpacity(1)
    this.completeToolbarShow()
  }

  private initializeToolbarWindow(): SelectionSurfaceWindow {
    const window = this.runtime.windowManager.createSelectionToolbarWindow()
    if (this.toolbarWebContentsId === window.webContents.id) return window

    this.toolbarWebContentsId = window.webContents.id

    this.toolbarLoaded = false
    window.webContents.on('did-finish-load', () => {
      this.toolbarLoaded = true
      // 页面加载后才能向页面传递信息
      this.showPendingToolbar(window)
    })
    window.on('hide', this.handleToolbarHidden)
    window.once('closed', () => {
      this.toolbarWebContentsId = undefined
      this.toolbarLoaded = false
      this.currentCapture = undefined
      this.handleToolbarHidden()
    })
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const load = window.loadURL(resolveRendererUrl('selection-toolbar.html'))
    void load.catch((error: unknown) => console.error('Failed to load selection toolbar', error))
    return window
  }

  private showPendingToolbar(window: SelectionSurfaceWindow): void {
    const capture = this.pendingToolbarCapture
    if (!capture || window.isDestroyed()) return
    this.pendingToolbarCapture = undefined
    const programName = capture.selection.programName.trim()
    const requestId = ++this.toolbarRenderRequestId
    const payload: SelectionToolbarPayload = {
      requestId,
      word: capture.selection.text.trim(),
      programName,
      canExclude: Boolean(programName),
      canCaptureExcerpt:
        capture.selection.text.trim().length > 0 && capture.selection.text.length <= 100_000,
      canTranslate:
        capture.selection.text.trim().length > 0 &&
        capture.selection.text.trim().length <= TRANSLATION_MAX_TEXT_LENGTH
    }
    const toolbarSize = this.syncToolbarSize(window)
    this.positionToolbar(window, toolbarSize)
    window.webContents.send('selection-toolbar:update', payload)

    if (process.platform === 'win32') {
      if (this.toolbarVisible) this.handleToolbarHidden()
      this.pendingToolbarRenderRequestId = requestId
      // Do not toggle native visibility after the first presentation. Transparent
      // BrowserWindows can flash when Windows adds them back to the DWM scene.
      window.setOpacity(0)
      window.setIgnoreMouseEvents(true)
      if (!window.isVisible()) showSelectionWindowInactive(window)
      return
    }

    showSelectionWindowInactive(window, {
      mainWindowToKeepHidden: this.runtime.mainWindow
    })
    this.completeToolbarShow()
  }

  private completeToolbarShow(): void {
    this.toolbarVisible = true
    this.subscribeToolbarDismissEvents()
    this.refreshDismissSubscription()
    this.scheduleToolbarAutoHide()
  }

  // 计算toolbar window的大小
  private syncToolbarSize(window: SelectionSurfaceWindow): { width: number; height: number } {
    const size = getSelectionToolbarWindowSize(process.platform)
    if (window.isDestroyed()) return size
    const [currentWidth, currentHeight] = window.getSize()
    if (currentWidth !== size.width || currentHeight !== size.height) {
      window.setSize(size.width, size.height, false)
    }
    return size
  }

  private scheduleToolbarAutoHide(): void {
    this.clearToolbarAutoHide()
    this.inactivityTimer = setTimeout(() => {
      this.inactivityTimer = undefined
      this.hideToolbar()
    }, TOOLBAR_INACTIVITY_TIMEOUT)
  }

  private readonly clearToolbarAutoHide = (): void => {
    if (!this.inactivityTimer) return
    clearTimeout(this.inactivityTimer)
    this.inactivityTimer = undefined
  }

  // 任意按键，滚轮会关闭toolbar
  private subscribeToolbarDismissEvents(): void {
    if (this.toolbarDismissSubscriptions.length > 0) return
    const selectionHook = this.runtime.selectionHookService
    this.toolbarDismissSubscriptions = [
      selectionHook.onKeyDown(this.handleGlobalKeyDown),
      selectionHook.onMouseWheel(this.handleMouseWheel)
    ]
  }

  private unsubscribeToolbarDismissEvents(): void {
    this.toolbarDismissSubscriptions.forEach((unsubscribe) => unsubscribe())
    this.toolbarDismissSubscriptions = []
  }

  private readonly handleToolbarHidden = (): void => {
    this.pendingToolbarCapture = undefined
    this.pendingToolbarRenderRequestId = undefined
    this.toolbarVisible = false
    this.clearToolbarAutoHide()
    this.unsubscribeToolbarDismissEvents()
    this.refreshDismissSubscription()
  }

  // 在toolbar，弹窗外的点击事件会关闭toolbar
  refreshDismissSubscription = (): void => {
    const shouldListen = Boolean(
      this.toolbarVisible || this.explanation.isVisible || this.translation.isVisible
    )
    if (shouldListen && !this.globalMouseDownUnsubscribe) {
      this.globalMouseDownUnsubscribe = this.runtime.selectionHookService.onMouseDown(
        this.handleGlobalMouseDown
      )
      return
    }
    if (shouldListen || !this.globalMouseDownUnsubscribe) return
    this.globalMouseDownUnsubscribe()
    this.globalMouseDownUnsubscribe = undefined
  }

  private positionToolbar(
    window: SelectionSurfaceWindow,
    size: { width: number; height: number }
  ): void {
    const anchor = this.anchor ?? createCursorAnchor()
    const shadowMargin = getToolbarShadowMargin()
    const bounds = fitNearSelection(
      { ...anchor, gap: anchor.gap - shadowMargin },
      size.width,
      size.height
    )
    window.setBounds(bounds, false)
  }

  private hideSelectionWindowsOutside(point: Point): void {
    const toolbar = this.currentToolbarWindow
    if (
      toolbar &&
      this.toolbarVisible &&
      !containsPoint(insetRectangle(toolbar.getBounds(), getToolbarShadowMargin()), point)
    ) {
      this.hideToolbar()
    }

    this.explanation.hideIfOutside(point)
    this.translation.hideIfOutside(point)
  }

  private acceptsTranslationSender(event: IpcMainEvent): boolean {
    const window = this.runtime.windowManager.selectionTranslationWindow
    return Boolean(window && !window.isDestroyed() && window.webContents.id === event.sender.id)
  }

  private acceptsToolbarSender(event: { sender: WebContents }): boolean {
    const window = this.currentToolbarWindow
    return Boolean(window && window.webContents.id === event.sender.id)
  }

  private hideToolbar(options: { activateMainWindow?: boolean } = {}): void {
    this.pendingToolbarCapture = undefined
    this.pendingToolbarRenderRequestId = undefined
    const window = this.currentToolbarWindow
    if (process.platform === 'win32' && window?.isVisible()) {
      // Keep the native surface alive and click-through; the next renderer frame
      // can be revealed by opacity without another hide/show compositor cycle.
      window.setIgnoreMouseEvents(true)
      window.setOpacity(0)
      this.handleToolbarHidden()
    } else if (window?.isVisible()) {
      if (options.activateMainWindow) window.hide()
      else hideSelectionWindow(window)
    } else {
      this.handleToolbarHidden()
    }
  }

  private get currentToolbarWindow(): SelectionSurfaceWindow | undefined {
    const window = this.runtime.windowManager.selectionToolbarWindow
    return window && !window.isDestroyed() ? window : undefined
  }

  private hasFocusedSelectionWindow(): boolean {
    return [
      this.currentToolbarWindow,
      this.explanation.currentWindow,
      this.runtime.windowManager.selectionTranslationWindow
    ].some((window) => window && !window.isDestroyed() && window.isFocused())
  }
}

function getToolbarShadowMargin(): number {
  return process.platform === 'win32' ? SELECTION_TOOLBAR_WINDOWS_SHADOW_MARGIN : 0
}
