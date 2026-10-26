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
import type { AppRuntime, OcrLookupMode } from '../app-runtime'
import type { OcrCapture } from '../ocr/ocr-capture-types'
import { captureTextUnderCursor } from '../ocr/ocr'
import {
  getSelectionToolbarWindowSize,
  SELECTION_TOOLBAR_WINDOWS_SHADOW_MARGIN,
  type ExternalExcerptCapture,
  type SelectionToolbarPayload
} from '../../shared/selection-toolbar'
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
import type { SelectionExplanationController } from './selection-explanation'
import type { TranslationController } from './translation'
import { TRANSLATION_MAX_TEXT_LENGTH } from '../../shared/translation'
import {
  clamp,
  containsPoint,
  createCursorAnchor,
  fitNearSelection,
  insetRectangle,
  toDisplayAnchor,
  toDisplayPoint,
  type SelectionAnchor
} from '../lib/selection-position'

const MAX_SELECTION_LENGTH = 200
const NATIVE_MENU_GAP = 6
const TOOLBAR_INACTIVITY_TIMEOUT = 5_000
export class SelectionToolbarController extends BaseController {
  constructor(
    runtime: AppRuntime,
    private readonly explanation: SelectionExplanationController,
    private readonly translation: TranslationController
  ) {
    super(runtime)
  }

  private dismissForMainExplanation(): void {
    this.currentCapture = undefined
    this.hideToolbar()
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
  private ocrCaptureVersion = 0

  override mount(): void {
    this.explanation.setOnVisibilityChange(this.refreshDismissSubscription)
    this.translation.setOnVisibilityChange(this.refreshDismissSubscription)
    this.runtime.selectionHookService.onSelection(this.handleSelection)
    ipcMain.on('selection-toolbar:lookup-in-main', this.lookupInMain)
    ipcMain.on('selection-toolbar:explain', this.explain)
    ipcMain.on('selection-toolbar:translate', this.translate)
    ipcMain.handle('selection-toolbar:copy', this.copy)
    ipcMain.on('selection-toolbar:open-menu', this.openNativeMenu)
    ipcMain.on('selection-toolbar:activity', this.handleToolbarActivity)
    ipcMain.on('selection-toolbar:rendered', this.handleToolbarRendered)
    ipcMain.on('selection-explanation:show-from-main', this.showExplanationFromMain)
    ipcMain.on('selection-explanation:close', this.closeExplanation)
    ipcMain.on('selection-explanation:toggle-pin', this.toggleExplanationPin)
    ipcMain.on('selection-explanation:open-in-main', this.openExplanationInMain)
    ipcMain.on('selection-explanation:loading-ready', this.explanationLoadingReady)
    ipcMain.on('selection-translation:close', this.closeTranslation)
    ipcMain.on('selection-translation:desired-height', this.resizeTranslation)
    ipcMain.handle('selection-toolbar:capture-excerpt', this.captureExcerpt)
    if (process.platform === 'darwin' || process.platform === 'win32') {
      this.runtime.ocrShortcutHandler = this.handleOcrShortcut
    }
  }

  private readonly handleOcrShortcut = async (mode: OcrLookupMode): Promise<void> => {
    const version = ++this.ocrCaptureVersion
    const anchor = createCursorAnchor()
    let ocrAiVersion: number | undefined
    const onCaptureReady =
      mode === 'ai'
        ? (): void => {
            if (version !== this.ocrCaptureVersion) return
            this.explanation.setAnchor(anchor)
            ocrAiVersion = this.explanation.beginOcrAiRecognition()
          }
        : undefined
    try {
      this.runtime.windowManager.hideOcrHighlight()
      this.explanation.prepareForOcrCapture()
      this.dismissForMainExplanation()
      if (mode === 'ai') this.explanation.prewarmExplanationWindow()
      const capture = await captureTextUnderCursor(mode, onCaptureReady)
      if (version !== this.ocrCaptureVersion) return
      this.explanation.setAnchor(anchor)
      if (!capture) {
        if (mode === 'ai' && ocrAiVersion !== undefined) {
          this.explanation.showOcrAiRecognitionError(ocrAiVersion, '鼠标下没有识别到可解释的文字。')
        } else {
          this.explanation.showOcrError(mode, '鼠标下没有识别到词语。')
        }
      } else if (mode === 'dictionary') {
        const lookup = this.explanation.showExplanation(capture.selection.word)
        this.showOcrHighlight(capture)
        await lookup
      } else if (
        ocrAiVersion !== undefined &&
        this.explanation.isOcrAiRecognitionCurrent(ocrAiVersion)
      ) {
        const explanation = this.explanation.showOcrAiExplanation(capture.selection, ocrAiVersion)
        this.showOcrHighlight(capture)
        await explanation
      }
    } catch (error) {
      if (version !== this.ocrCaptureVersion) return
      this.explanation.setAnchor(anchor)
      const message = error instanceof Error ? error.message : '悬停取词失败。'
      if (mode === 'ai' && ocrAiVersion !== undefined) {
        this.explanation.showOcrAiRecognitionError(ocrAiVersion, message)
      } else {
        this.explanation.showOcrError(mode, message)
      }
    }
  }

  private showOcrHighlight(capture: OcrCapture): void {
    try {
      this.runtime.windowManager.showOcrHighlight(capture.wordBounds, capture.wordQuad)
    } catch (error) {
      this.runtime.windowManager.hideOcrHighlight()
      console.error('Failed to show OCR word highlight', error)
    }
  }

  private readonly showExplanationFromMain = (event: IpcMainEvent, word: unknown): void => {
    const mainWindow = this.runtime.mainWindow
    if (!mainWindow || mainWindow.webContents.id !== event.sender.id || typeof word !== 'string') {
      return
    }
    const normalizedWord = word.trim()
    if (!normalizedWord || normalizedWord.length > MAX_SELECTION_LENGTH) return

    this.explanation.setAnchor(createCursorAnchor())
    this.dismissForMainExplanation()
    void this.explanation.showExplanation(normalizedWord)
  }

  private readonly closeExplanation = (event: IpcMainEvent): void => {
    if (this.acceptsExplanationSender(event)) this.explanation.hideExplanation()
  }

  private readonly toggleExplanationPin = (event: IpcMainEvent): void => {
    if (!this.acceptsExplanationSender(event)) return
    this.explanation.setPinned(this.runtime.windowManager.toggleSelectionExplanationPinned())
  }

  private readonly openExplanationInMain = (event: IpcMainEvent): void => {
    if (!this.acceptsExplanationSender(event)) return
    const lookup = this.explanation.currentLookup
    if (!lookup) return
    this.explanation.hideExplanation()
    this.openWordInMain(lookup.word, lookup.dictionaryId)
  }

  private readonly explanationLoadingReady = (event: IpcMainEvent, requestId: number): void => {
    if (this.acceptsExplanationSender(event)) this.explanation.markLoadingReady(requestId)
  }

  private readonly closeTranslation = (event: IpcMainEvent): void => {
    if (this.acceptsTranslationSender(event)) this.translation.hide()
  }

  private readonly resizeTranslation = (
    event: IpcMainEvent,
    version: number,
    desiredHeight: number
  ): void => {
    if (this.acceptsTranslationSender(event)) {
      this.translation.resizeSelectionWindow(version, desiredHeight)
    }
  }

  private readonly handleSelection: SelectionListener = (capture): void => {
    const word = capture.selection.text.trim()
    if (!word) return

    if (capture.source === 'shortcut') {
      this.currentCapture = capture
      this.anchor = toDisplayAnchor(capture)
      this.explanation.setAnchor(this.anchor)
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
    this.explanation.setAnchor(this.anchor)

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
    const anchor = this.anchor
    this.hideToolbar()
    this.translation.showSelection(text, anchor)
  }

  private readonly lookupInMain = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event)) return
    const word = this.currentCapture?.selection.text.trim()
    if (!word || word.length > MAX_SELECTION_LENGTH) return

    this.hideToolbar({ activateMainWindow: true })
    this.openWordInMain(word)
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

  private disableCurrentApp(): void {
    if (!this.currentCapture) return
    const programName = this.currentCapture.selection.programName.trim()
    if (!programName) return

    try {
      this.runtime.appConfig.addExcludedProgram(programName)
      this.runtime.restartInputServices()
      this.hideToolbar()
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
        surface.showDisableSelectionMenu(Boolean(programName))
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
        click: () => this.disableCurrentApp()
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

    if (window instanceof NativeSelectionPanel) {
      window.on('disable-selection', () => this.disableCurrentApp())
    }

    this.toolbarLoaded = false
    window.webContents.on('did-finish-load', () => {
      this.toolbarLoaded = true
      // 页面加载后才能向页面传递信息
      this.showPendingToolbar(window)
    })
    window.on('hide', this.handleToolbarHidden)
    window.on('closed', this.handleToolbarHidden)
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

  private openWordInMain(word: string, dictionaryId?: string): void {
    const selectionDictionaryGroupId = this.runtime.selectionDictionaryGroupId
    if (this.runtime.dictionarySearchScope.get() !== selectionDictionaryGroupId) {
      this.runtime.dictionarySearchScope.set(selectionDictionaryGroupId, 'search-panel')
    }

    this.runtime.activateMainWindow()
    const mainWindow = this.runtime.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

    const sendLookup = (): void => {
      if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('app:search-request', {
          term: word,
          source: 'selection',
          ...(dictionaryId ? { dictionaryId } : {})
        })
      }
    }
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', sendLookup)
    } else {
      sendLookup()
    }
  }

  private acceptsExplanationSender(event: IpcMainEvent): boolean {
    return Boolean(this.explanation.currentWindow?.webContents.id === event.sender.id)
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
