import {
  clipboard,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Point,
  type Rectangle
} from 'electron'
import type { DictionaryEntryRecord, DictionaryMatch } from '../db-service'
import type {
  SelectionExplanationDictionary,
  SelectionExplanationPayload
} from '../../shared/selection-explanation'
import {
  getSelectionToolbarWindowSize,
  SELECTION_TOOLBAR_WINDOWS_SHADOW_MARGIN,
  type SelectionToolbarPayload
} from '../../shared/selection-toolbar'
import type {
  CapturedSelection,
  KeyDownListener,
  MouseDownListener,
  MouseWheelListener,
  SelectionListener
} from '../selection-hook-service'
import type { WebContentsViewManager } from '../web-contents-view-manager'
import { createDictionaryEntryUrl } from '../dictionary-entry-url'
import { resolveRendererUrl } from '../output-path'
import { hideSelectionWindow, showSelectionWindowInactive } from '../selection-window-behavior'
import { BaseController } from './base-controller'

const MAX_SELECTION_LENGTH = 200
const MOUSE_ANCHOR_GAP = 16
const SELECTION_ANCHOR_GAP = 4
const EXPLANATION_SELECTION_GAP = 8
const EXPLANATION_POINTER_OFFSET = 12
const EXPLANATION_SCREEN_MARGIN = 12
const EXPLANATION_MIN_WIDTH = 360
const EXPLANATION_MIN_HEIGHT = 300
const NATIVE_MENU_GAP = 6
const TOOLBAR_INACTIVITY_TIMEOUT = 5_000
const INVALID_COORDINATE = -99_999
const POSITION_LEVEL = {
  NONE: 0,
  MOUSE_SINGLE: 1,
  MOUSE_DUAL: 2,
  SEL_FULL: 3,
  SEL_DETAILED: 4
} as const

type SelectionAnchor = {
  centerX: number
  top: number
  bottom: number
  gap: number
  posLevel: CapturedSelection['selection']['posLevel']
}

type ExplanationSize = {
  width: number
  height: number
}

type PendingExplanationLoading = {
  requestId: number
  resolve: () => void
}

export class SelectionToolbarController extends BaseController {
  private currentCapture: CapturedSelection | undefined
  private pendingToolbarCapture: CapturedSelection | undefined
  private anchor: SelectionAnchor | undefined
  private toolbarWebContentsId: number | undefined
  private explanationWebContentsId: number | undefined
  private toolbarLoaded = false
  // Windows keeps the transparent native window shown at zero opacity to avoid
  // DWM flicker, so native isVisible() is not the toolbar's logical visibility.
  private toolbarVisible = false
  private toolbarRenderRequestId = 0
  private pendingToolbarRenderRequestId: number | undefined
  private explanationLoaded = false
  private explanationPayload: SelectionExplanationPayload | undefined
  private explanationDictionaryMatches: DictionaryMatch[] = []
  private loadedExplanationDictionaryId: string | undefined
  private pendingExplanationLoading: PendingExplanationLoading | undefined
  private lookupVersion = 0
  private preferredExplanationSize: ExplanationSize = { width: 520, height: 600 }
  private appliedExplanationSize: ExplanationSize | undefined
  private inactivityTimer: ReturnType<typeof setTimeout> | undefined
  private nativeMenu: Menu | undefined
  private activeAiRequestId: string | undefined
  private toolbarDismissSubscriptions: Array<() => void> = []
  private globalMouseDownUnsubscribe: (() => void) | undefined

  override mount(): void {
    this.runtime.selectionHookService.onSelection(this.handleSelection)
    ipcMain.on('selection-toolbar:lookup-in-main', this.lookupInMain)
    ipcMain.on('selection-toolbar:explain', this.explain)
    ipcMain.on('selection-toolbar:ai-explain', this.aiExplain)
    ipcMain.on('selection-toolbar:copy', this.copy)
    ipcMain.on('selection-toolbar:google', this.google)
    ipcMain.on('selection-toolbar:open-menu', this.openNativeMenu)
    ipcMain.on('selection-toolbar:activity', this.handleToolbarActivity)
    ipcMain.on('selection-toolbar:rendered', this.handleToolbarRendered)
    ipcMain.on('selection-explanation:close', this.closeExplanation)
    ipcMain.on('selection-explanation:loading-ready', this.handleExplanationLoadingReady)
    ipcMain.on('selection-explanation:select-dictionary', this.selectExplanationDictionary)
    ipcMain.on('selection-explanation:open-in-main', this.openExplanationInMain)
    ipcMain.on('selection-explanation:lookup-word', this.lookupFromExplanation)
    ipcMain.on('selection-explanation:copy-text', this.copyFromExplanation)
    ipcMain.handle('selection-explanation:is-starred', this.isWordStarred)
    ipcMain.handle('selection-explanation:toggle-star', this.toggleWordStar)
  }

  private readonly handleSelection: SelectionListener = (capture): void => {
    const word = capture.selection.text.trim()
    if (!word) return

    if (capture.source === 'shortcut') {
      this.currentCapture = capture
      this.anchor = toDisplayAnchor(capture)
      this.hideToolbar()
      void this.showExplanation(word)
      return
    }

    if (capture.source !== 'selection' || BrowserWindow.getFocusedWindow()) return
    this.currentCapture = capture
    this.pendingToolbarCapture = capture
    this.anchor = toDisplayAnchor(capture)
    this.hideExplanation()

    const window = this.initializeToolbarWindow()
    const toolbarSize = this.syncToolbarSize(window, this.runtime.appConfig.load().aiLookup.enabled)
    this.positionToolbar(window, toolbarSize.height)
    if (this.toolbarLoaded) this.showPendingToolbar(window)
    this.prewarmExplanationWindow()
  }

  private readonly handleGlobalMouseDown: MouseDownListener = (event): void => {
    console.log('[selection-popup] global mouse-down', {
      toolbarVisible: this.toolbarVisible,
      explanationVisible: this.currentExplanationWindow?.isVisible() ?? false,
      ignoredForNativeMenu: Boolean(this.nativeMenu)
    })
    if (this.nativeMenu) return

    const point = toDisplayPoint(event)
    this.hideSelectionWindowsOutside(point)
  }

  private readonly handleGlobalKeyDown: KeyDownListener = (): void => {
    console.log('[selection-popup] global key-down', {
      toolbarVisible: this.toolbarVisible,
      explanationVisible: this.currentExplanationWindow?.isVisible() ?? false
    })
    this.hideToolbar()
  }

  private readonly handleMouseWheel: MouseWheelListener = (): void => {
    console.log('[selection-popup] global mouse-wheel', {
      toolbarVisible: this.toolbarVisible,
      explanationVisible: this.currentExplanationWindow?.isVisible() ?? false
    })
    // Keep the explanation document scrollable. Only the short-lived selection
    // toolbar is dismissed by a global scroll gesture.
    this.hideToolbar()
  }

  private readonly explain = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event) || !this.currentCapture) return
    const word = this.currentCapture.selection.text.trim()
    this.hideToolbar()
    void this.showExplanation(word)
  }

  private readonly aiExplain = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event) || !this.currentCapture) return
    if (!this.runtime.appConfig.load().aiLookup.enabled) return
    const word = this.currentCapture.selection.text.trim()
    if (!word) return
    this.hideToolbar()
    void this.showAiExplanation(word)
  }

  private readonly lookupInMain = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event)) return
    const word = this.currentCapture?.selection.text.trim()
    if (!word || word.length > MAX_SELECTION_LENGTH) return

    this.hideToolbar()
    this.openWordInMain(word)
  }

  private readonly copy = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event)) return
    const word = this.currentCapture?.selection.text.trim()
    if (!word || word.length > MAX_SELECTION_LENGTH) return
    clipboard.writeText(word)
    this.hideToolbar()
  }

  private readonly google = (event: IpcMainEvent): void => {
    if (!this.acceptsToolbarSender(event)) return
    const word = this.currentCapture?.selection.text.trim()
    if (!word || word.length > MAX_SELECTION_LENGTH) return

    this.hideToolbar()
    void shell
      .openExternal(`https://www.google.com/search?q=${encodeURIComponent(word)}`)
      .catch((error: unknown) => {
        console.error('Failed to open Google search for selected text', { word, error })
      })
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
    if (!this.acceptsToolbarSender(event) || !this.currentCapture || this.nativeMenu) return
    const window = this.currentToolbarWindow
    if (!window) return

    const programName = this.currentCapture.selection.programName.trim()
    const menu = Menu.buildFromTemplate([
      {
        label: '在此应用禁用',
        enabled: Boolean(programName),
        click: () => this.disableCurrentApp()
      }
    ])
    this.nativeMenu = menu
    this.clearToolbarAutoHide()
    const cursorPoint = screen.getCursorScreenPoint()
    const toolbarBounds = window.getBounds()
    const toolbarShadowMargin = getToolbarShadowMargin()

    try {
      menu.popup({
        window,
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

  private readonly closeExplanation = (event: IpcMainEvent): void => {
    if (this.acceptsExplanationSender(event)) this.hideExplanation()
  }

  private readonly handleExplanationLoadingReady = (
    event: IpcMainEvent,
    requestId: number
  ): void => {
    if (
      !this.acceptsExplanationSender(event) ||
      !Number.isSafeInteger(requestId) ||
      requestId !== this.lookupVersion ||
      requestId !== this.pendingExplanationLoading?.requestId
    ) {
      return
    }

    const pending = this.pendingExplanationLoading
    this.pendingExplanationLoading = undefined
    pending.resolve()
  }

  private readonly openExplanationInMain = (event: IpcMainEvent): void => {
    if (!this.acceptsExplanationSender(event)) return
    const word = this.explanationPayload?.word.trim()
    if (!word || word.length > MAX_SELECTION_LENGTH) return
    this.hideExplanation()
    this.openWordInMain(word)
  }

  private readonly selectExplanationDictionary = (
    event: IpcMainEvent,
    dictionaryId: string
  ): void => {
    if (
      !this.acceptsExplanationSender(event) ||
      typeof dictionaryId !== 'string' ||
      this.explanationPayload?.mode !== 'dictionary'
    ) {
      return
    }

    const match = this.explanationDictionaryMatches.find(
      (dictionary) => dictionary.dictionaryId === dictionaryId
    )
    if (!match) return
    if (
      this.explanationPayload.activeDictionaryId === dictionaryId &&
      (this.explanationPayload.state === 'loading' ||
        this.explanationPayload.state === 'refreshing' ||
        this.explanationPayload.state === 'content')
    ) {
      return
    }
    void this.showExplanationDictionary(match)
  }

  private readonly isWordStarred = async (
    event: IpcMainInvokeEvent,
    word: string
  ): Promise<boolean> => {
    const normalizedWord = this.getCurrentExplanationWord(event, word)
    if (!normalizedWord) return false
    return await this.db.isWordStarred(normalizedWord)
  }

  private readonly toggleWordStar = async (
    event: IpcMainInvokeEvent,
    word: string
  ): Promise<void> => {
    const normalizedWord = this.getCurrentExplanationWord(event, word)
    if (!normalizedWord) return
    await this.db.toggleStarWord(normalizedWord)
  }

  private readonly lookupFromExplanation = (event: IpcMainEvent, word: string): void => {
    if (!this.acceptsExplanationViewSender(event) || typeof word !== 'string') return
    const normalizedWord = word.trim()
    if (!normalizedWord || normalizedWord.length > MAX_SELECTION_LENGTH) return
    void this.showExplanation(normalizedWord)
  }

  private readonly copyFromExplanation = (event: IpcMainEvent, text: string): void => {
    if (
      !this.acceptsExplanationViewSender(event) ||
      typeof text !== 'string' ||
      !text ||
      text.length > 100_000
    ) {
      return
    }
    clipboard.writeText(text)
  }

  private initializeToolbarWindow(): BrowserWindow {
    const window = this.runtime.windowManager.createSelectionToolbarWindow()
    if (this.toolbarWebContentsId === window.webContents.id) return window
    this.toolbarWebContentsId = window.webContents.id
    this.toolbarLoaded = false

    window.webContents.on('did-finish-load', () => {
      this.toolbarLoaded = true
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

  private showPendingToolbar(window: BrowserWindow): void {
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
      aiEnabled: this.runtime.appConfig.load().aiLookup.enabled
    }
    const toolbarSize = this.syncToolbarSize(window, payload.aiEnabled)
    this.positionToolbar(window, toolbarSize.height)
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
      mainWindowToKeepHidden: this.runtime.mainWindow,
      preventActivationOnClick: true
    })
    this.completeToolbarShow()
  }

  private completeToolbarShow(): void {
    this.toolbarVisible = true
    this.subscribeToolbarDismissEvents()
    this.syncGlobalMouseDownSubscription()
    this.scheduleToolbarAutoHide()
  }

  private syncToolbarSize(
    window: BrowserWindow,
    aiEnabled: boolean
  ): { width: number; height: number } {
    const size = getSelectionToolbarWindowSize(aiEnabled, process.platform)
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
    this.syncGlobalMouseDownSubscription()
  }

  private readonly syncGlobalMouseDownSubscription = (): void => {
    const shouldListen = Boolean(this.toolbarVisible || this.currentExplanationWindow?.isVisible())
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

  private initializeExplanationWindow(): BrowserWindow {
    const window = this.runtime.windowManager.createSelectionExplanationWindow()
    if (this.explanationWebContentsId === window.webContents.id) return window
    this.explanationWebContentsId = window.webContents.id
    this.explanationLoaded = false

    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return
      event.preventDefault()
      this.hideExplanation()
    })
    window.on('resize', () => this.rememberExplanationSize(window))
    window.on('hide', this.syncGlobalMouseDownSubscription)
    window.on('closed', this.syncGlobalMouseDownSubscription)
    window.webContents.on('did-finish-load', () => {
      this.explanationLoaded = true
      this.flushExplanationPayload()
      if (
        this.explanationPayload?.mode === 'ai' &&
        this.explanationPayload.requestId === this.lookupVersion
      ) {
        this.showExplanationWindow(window)
      }
    })
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.configureExplanationView()

    const load = window.loadURL(resolveRendererUrl('selection-explanation.html'))
    void load.catch((error: unknown) =>
      console.error('Failed to load selection explanation shell', error)
    )
    return window
  }

  private prewarmExplanationWindow(): void {
    if (this.currentExplanationWindow) return
    setImmediate(() => {
      try {
        this.initializeExplanationWindow()
      } catch (error) {
        console.error('Failed to prewarm selection explanation window', error)
      }
    })
  }

  private showExplanationWindow(window: BrowserWindow): void {
    showSelectionWindowInactive(window, {
      mainWindowToKeepHidden: this.runtime.mainWindow
    })
    this.syncGlobalMouseDownSubscription()
  }

  private configureExplanationView(): void {
    const view = this.explanationView
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return
      event.preventDefault()
      this.hideExplanation()
    })
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url).catch((error: unknown) => {
          console.error('Failed to open dictionary external URL', { url, error })
        })
      }
      return { action: 'deny' }
    })
    view.webContents.on('will-navigate', (event) => {
      if (event.url.startsWith('dictol-entry://')) return
      event.preventDefault()
      if (event.url.startsWith('entry://')) {
        const word = decodeEntryTarget(event.url)
        if (word) void this.showExplanation(word)
      }
    })
  }

  private async showExplanation(word: string): Promise<void> {
    const normalizedWord = word.trim()
    if (!normalizedWord || normalizedWord.length > MAX_SELECTION_LENGTH) return

    this.cancelAiExplanation()
    this.explanationDictionaryMatches = []
    this.loadedExplanationDictionaryId = undefined
    this.runtime.windowManager.setSelectionExplanationSwitcherVisible(false)
    const version = ++this.lookupVersion
    const window = this.initializeExplanationWindow()
    const keepWindowVisible = window.isVisible()
    this.resolvePendingExplanationLoading()
    const loadingReady = this.waitForExplanationLoading(version)
    this.explanationView.hide()
    this.updateExplanation({
      mode: 'dictionary',
      requestId: version,
      word: normalizedWord,
      state: 'loading'
    })
    this.positionExplanation(window)

    try {
      const startedAt = performance.now()
      const lookupPromise = this.db.lookupDictionaryEntryGroup(normalizedWord).then(
        (group) => {
          console.debug('[DictionaryLookup] selection popup', {
            term: normalizedWord,
            takeMs: performance.now() - startedAt,
            matched: Boolean(group)
          })
          return group
        },
        (error: unknown) => {
          console.debug('[DictionaryLookup] selection popup', {
            term: normalizedWord,
            takeMs: performance.now() - startedAt,
            matched: false,
            failed: true
          })
          throw error
        }
      )
      await loadingReady
      if (version !== this.lookupVersion) return
      if (!keepWindowVisible) this.showExplanationWindow(window)

      const group = await lookupPromise
      if (version !== this.lookupVersion) return
      const firstMatch = group?.dictionaries[0]
      if (!firstMatch) {
        const hasReadyDictionary = (await this.db.listReadyDictionaries()).length > 0
        if (version !== this.lookupVersion) return
        this.explanationView.hide()
        this.updateExplanation({
          mode: 'dictionary',
          requestId: version,
          word: normalizedWord,
          state: 'empty',
          message: hasReadyDictionary
            ? `所有词典中都没有找到“${normalizedWord}”的解释。`
            : '还没有可用词典，请先在主应用中导入词典。'
        })
        return
      }

      this.explanationDictionaryMatches = group.dictionaries
      const dictionaries = this.getExplanationDictionaryOptions()
      this.runtime.windowManager.setSelectionExplanationSwitcherVisible(dictionaries.length > 1)
      this.updateExplanation({
        mode: 'dictionary',
        requestId: version,
        word: normalizedWord,
        dictionaryName: firstMatch.dictionaryName,
        dictionaries,
        activeDictionaryId: firstMatch.dictionaryId,
        state: 'loading'
      })
      const entry = await this.db.getDictionaryEntryRecord(firstMatch.entryId)
      if (version !== this.lookupVersion) return
      if (!entry) throw new Error('首个词典命中的词条记录不存在')

      await this.loadExplanationEntry(entry, version, normalizedWord, dictionaries, true)
    } catch (error) {
      if (version !== this.lookupVersion || isNavigationAborted(error)) return
      console.error('Failed to show selection explanation', { word: normalizedWord, error })
      this.explanationView.hide()
      const dictionaries = this.getExplanationDictionaryOptions()
      const activeDictionaryId = this.explanationPayload?.activeDictionaryId
      this.updateExplanation({
        mode: 'dictionary',
        requestId: version,
        word: normalizedWord,
        dictionaryName: this.explanationPayload?.dictionaryName,
        dictionaries: dictionaries.length > 0 ? dictionaries : undefined,
        activeDictionaryId,
        state: 'error',
        message: '词条内容加载失败，请稍后再试。'
      })
    }
  }

  private showAiExplanation(word: string): void {
    const normalizedWord = word.trim()
    if (!normalizedWord) return

    this.resolvePendingExplanationLoading()
    this.explanationDictionaryMatches = []
    this.loadedExplanationDictionaryId = undefined
    this.runtime.windowManager.setSelectionExplanationSwitcherVisible(false)
    const version = ++this.lookupVersion
    const requestId = `selection-${version}`
    this.cancelAiExplanation()
    this.activeAiRequestId = requestId
    const window = this.initializeExplanationWindow()
    this.explanationView.hide()
    this.updateExplanation({
      mode: 'ai',
      requestId: version,
      word: normalizedWord,
      state: 'loading'
    })
    this.positionExplanation(window)
    if (this.explanationLoaded) this.showExplanationWindow(window)

    let content = ''
    this.runtime.aiLookupService.start(
      requestId,
      [{ role: 'user', content: normalizedWord }],
      'selection-toolbar',
      (event) => {
        if (
          (event.type === 'done' || event.type === 'error') &&
          this.activeAiRequestId === requestId
        ) {
          this.activeAiRequestId = undefined
        }
        if (version !== this.lookupVersion) return
        if (event.type === 'task') {
          return
        } else if (event.type === 'delta') {
          content += event.text
          this.updateExplanation({
            mode: 'ai',
            requestId: version,
            word: normalizedWord,
            state: 'content',
            content
          })
        } else if (event.type === 'done') {
          this.updateExplanation({
            mode: 'ai',
            requestId: version,
            word: normalizedWord,
            state: 'content',
            content
          })
        } else {
          this.updateExplanation({
            mode: 'ai',
            requestId: version,
            word: normalizedWord,
            state: 'error',
            message: event.message
          })
        }
      },
      undefined,
      { sourceText: normalizedWord }
    )
  }

  private async showExplanationDictionary(match: DictionaryMatch): Promise<void> {
    const word = this.explanationPayload?.word.trim()
    if (!word) return

    const version = ++this.lookupVersion
    this.resolvePendingExplanationLoading()
    this.cancelAiExplanation()
    const dictionaries = this.getExplanationDictionaryOptions()
    this.updateExplanation({
      mode: 'dictionary',
      requestId: version,
      word,
      dictionaryName: match.dictionaryName,
      dictionaries,
      activeDictionaryId: match.dictionaryId,
      state: 'refreshing'
    })

    try {
      const entry = await this.db.getDictionaryEntryRecord(match.entryId)
      if (version !== this.lookupVersion) return
      if (!entry) throw new Error('所选词典的词条记录不存在')
      await this.loadExplanationEntry(entry, version, word, dictionaries, false)
    } catch (error) {
      if (version !== this.lookupVersion || isNavigationAborted(error)) return
      console.error('Failed to switch selection explanation dictionary', {
        word,
        dictionaryId: match.dictionaryId,
        error
      })
      const loadedDictionary = this.explanationDictionaryMatches.find(
        (dictionary) => dictionary.dictionaryId === this.loadedExplanationDictionaryId
      )
      this.updateExplanation(
        loadedDictionary
          ? {
              mode: 'dictionary',
              requestId: version,
              word,
              dictionaryName: loadedDictionary.dictionaryName,
              dictionaries,
              activeDictionaryId: loadedDictionary.dictionaryId,
              state: 'content'
            }
          : {
              mode: 'dictionary',
              requestId: version,
              word,
              dictionaryName: match.dictionaryName,
              dictionaries,
              activeDictionaryId: match.dictionaryId,
              state: 'error',
              message: '该词典的词条内容加载失败，请稍后再试。'
            }
      )
    }
  }

  private async loadExplanationEntry(
    entry: DictionaryEntryRecord,
    version: number,
    word: string,
    dictionaries: SelectionExplanationDictionary[],
    recordQuery: boolean
  ): Promise<void> {
    const view = this.explanationView
    const url = createDictionaryEntryUrl(entry.dictionaryId, entry.id)
    let shown = false
    const showLoadedEntry = (): void => {
      if (shown || version !== this.lookupVersion || view.webContents.getURL() !== url) return
      shown = true
      this.updateExplanation({
        mode: 'dictionary',
        requestId: version,
        word,
        dictionaryName: entry.dictionaryName,
        dictionaries,
        activeDictionaryId: entry.dictionaryId,
        state: 'content'
      })
      view.show()
      this.loadedExplanationDictionaryId = entry.dictionaryId
      if (recordQuery) this.recordSuccessfulQuery(word)
    }
    const handleDomReady = (): void => showLoadedEntry()
    view.webContents.on('dom-ready', handleDomReady)

    try {
      await view.loadURL(url)
      showLoadedEntry()
    } finally {
      view.webContents.off('dom-ready', handleDomReady)
    }
  }

  private recordSuccessfulQuery(word: string): void {
    void this.db
      .recordQueryHistory(word)
      .then(() => {
        const mainWindow = this.runtime.mainWindow
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('query-history:changed')
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to record selection query history', { word, error })
      })
  }

  private getExplanationDictionaryOptions(): SelectionExplanationDictionary[] {
    return this.explanationDictionaryMatches.map((dictionary) => ({
      dictionaryId: dictionary.dictionaryId,
      dictionaryName: dictionary.dictionaryName,
      dictionaryIconUrl: dictionary.dictionaryIconUrl
    }))
  }

  private updateExplanation(payload: SelectionExplanationPayload): void {
    this.explanationPayload = payload
    this.flushExplanationPayload()
  }

  private waitForExplanationLoading(requestId: number): Promise<void> {
    return new Promise((resolve) => {
      this.pendingExplanationLoading = { requestId, resolve }
    })
  }

  private resolvePendingExplanationLoading(): void {
    const pending = this.pendingExplanationLoading
    this.pendingExplanationLoading = undefined
    pending?.resolve()
  }

  private flushExplanationPayload(): void {
    const window = this.currentExplanationWindow
    if (!window || !this.explanationLoaded || !this.explanationPayload) return
    window.webContents.send('selection-explanation:update', this.explanationPayload)
  }

  private positionToolbar(window: BrowserWindow, height: number): void {
    const anchor = this.anchor ?? createCursorAnchor()
    const shadowMargin = getToolbarShadowMargin()
    const bounds = fitNearSelection(
      { ...anchor, gap: anchor.gap - shadowMargin },
      window.getBounds().width,
      height
    )
    window.setBounds(bounds, false)
  }

  private positionExplanation(window: BrowserWindow): void {
    const anchor = this.anchor ?? createCursorAnchor()
    const bounds = fitExplanationNearSelection(anchor, this.preferredExplanationSize)
    this.appliedExplanationSize = { width: bounds.width, height: bounds.height }
    window.setBounds(bounds, false)
  }

  private rememberExplanationSize(window: BrowserWindow): void {
    if (window.isDestroyed()) return
    const [width, height] = window.getSize()
    const appliedSize = this.appliedExplanationSize
    this.appliedExplanationSize = undefined
    if (appliedSize?.width === width && appliedSize.height === height) return
    this.preferredExplanationSize = {
      width: Math.max(EXPLANATION_MIN_WIDTH, width),
      height: Math.max(EXPLANATION_MIN_HEIGHT, height)
    }
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

    const explanation = this.currentExplanationWindow
    if (explanation?.isVisible() && !containsPoint(explanation.getBounds(), point)) {
      this.hideExplanation()
    }
  }

  private acceptsToolbarSender(event: IpcMainEvent): boolean {
    const window = this.currentToolbarWindow
    return Boolean(window && window.webContents.id === event.sender.id)
  }

  private hideToolbar(): void {
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
      hideSelectionWindow(window)
    } else {
      this.handleToolbarHidden()
    }
  }

  private hideExplanation(): void {
    this.lookupVersion += 1
    this.cancelAiExplanation()
    this.resolvePendingExplanationLoading()
    this.explanationDictionaryMatches = []
    this.loadedExplanationDictionaryId = undefined
    this.runtime.windowManager.setSelectionExplanationSwitcherVisible(false)
    const window = this.currentExplanationWindow
    if (window?.isVisible()) {
      hideSelectionWindow(window)
    } else {
      this.syncGlobalMouseDownSubscription()
    }
  }

  private cancelAiExplanation(): void {
    if (!this.activeAiRequestId) return
    this.runtime.aiLookupService.cancel(this.activeAiRequestId)
    this.activeAiRequestId = undefined
  }

  private openWordInMain(word: string): void {
    const existingWindow = this.runtime.mainWindow
    let mainWindow: BrowserWindow
    try {
      mainWindow = existingWindow ?? this.runtime.getOrCreateMainWindow()
    } catch (error) {
      console.error('Failed to create main window for selection lookup', { word, error })
      return
    }
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()

    const sendLookup = (): void => {
      if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('word-capture:event', { type: 'lookup', text: word })
      }
    }
    if (!existingWindow && mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', sendLookup)
    } else {
      sendLookup()
    }
  }

  private acceptsExplanationSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const window = this.currentExplanationWindow
    return Boolean(window && window.webContents.id === event.sender.id)
  }

  private getCurrentExplanationWord(
    event: IpcMainEvent | IpcMainInvokeEvent,
    word: unknown
  ): string | undefined {
    if (!this.acceptsExplanationSender(event) || typeof word !== 'string') return undefined
    const normalizedWord = word.trim()
    if (!normalizedWord || normalizedWord.length > MAX_SELECTION_LENGTH) return undefined
    if (
      this.explanationPayload?.mode !== 'dictionary' ||
      this.explanationPayload.state !== 'content' ||
      this.explanationPayload.word.trim() !== normalizedWord
    ) {
      return undefined
    }
    return normalizedWord
  }

  private acceptsExplanationViewSender(event: IpcMainEvent): boolean {
    const view = this.runtime.windowManager.selectionExplanationView
    return Boolean(view && !view.isDestroyed && view.acceptsSender(event.sender.id))
  }

  private get currentToolbarWindow(): BrowserWindow | undefined {
    const window = this.runtime.windowManager.selectionToolbarWindow
    return window && !window.isDestroyed() ? window : undefined
  }

  private get currentExplanationWindow(): BrowserWindow | undefined {
    const window = this.runtime.windowManager.selectionExplanationWindow
    return window && !window.isDestroyed() ? window : undefined
  }

  private get explanationView(): WebContentsViewManager {
    const view = this.runtime.windowManager.selectionExplanationView
    if (!view || view.isDestroyed) throw new Error('SelectionExplanationView 尚未初始化')
    return view
  }
}

function toDisplayAnchor(capture: CapturedSelection): SelectionAnchor {
  const selection = capture.selection

  switch (selection.posLevel) {
    case POSITION_LEVEL.MOUSE_SINGLE:
    case POSITION_LEVEL.MOUSE_DUAL:
      return createMouseAnchor(selection)
    case POSITION_LEVEL.SEL_FULL:
    case POSITION_LEVEL.SEL_DETAILED:
      return createSelectionAnchor(selection)
    case POSITION_LEVEL.NONE:
    default:
      return createCursorAnchor()
  }
}

function createMouseAnchor(selection: CapturedSelection['selection']): SelectionAnchor {
  return isValidPoint(selection.mousePosEnd)
    ? toDisplayCoordinates(
        pointToAnchor(selection.mousePosEnd, MOUSE_ANCHOR_GAP, selection.posLevel)
      )
    : createCursorAnchor()
}

function createSelectionAnchor(selection: CapturedSelection['selection']): SelectionAnchor {
  if (!isValidPoint(selection.endBottom)) return createMouseAnchor(selection)

  const top = isValidPoint(selection.endTop) ? selection.endTop.y : selection.endBottom.y
  return toDisplayCoordinates({
    centerX: selection.endBottom.x,
    top: Math.min(top, selection.endBottom.y),
    bottom: Math.max(top, selection.endBottom.y),
    gap: SELECTION_ANCHOR_GAP,
    posLevel: selection.posLevel
  })
}

function createCursorAnchor(): SelectionAnchor {
  return pointToAnchor(screen.getCursorScreenPoint(), MOUSE_ANCHOR_GAP, POSITION_LEVEL.NONE)
}

function isValidPoint(point: Point): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x !== INVALID_COORDINATE &&
    point.y !== INVALID_COORDINATE
  )
}

function toDisplayCoordinates(anchor: SelectionAnchor): SelectionAnchor {
  if (process.platform === 'darwin') {
    return {
      centerX: Math.round(anchor.centerX),
      top: Math.round(anchor.top),
      bottom: Math.round(anchor.bottom),
      gap: anchor.gap,
      posLevel: anchor.posLevel
    }
  }

  const top = screen.screenToDipPoint({ x: Math.round(anchor.centerX), y: Math.round(anchor.top) })
  const bottom = screen.screenToDipPoint({
    x: Math.round(anchor.centerX),
    y: Math.round(anchor.bottom)
  })
  return {
    centerX: bottom.x,
    top: Math.min(top.y, bottom.y),
    bottom: Math.max(top.y, bottom.y),
    gap: anchor.gap,
    posLevel: anchor.posLevel
  }
}

function toDisplayPoint(point: Point): Point {
  if (!isValidPoint(point)) return screen.getCursorScreenPoint()

  const roundedPoint = { x: Math.round(point.x), y: Math.round(point.y) }
  return process.platform === 'darwin' ? roundedPoint : screen.screenToDipPoint(roundedPoint)
}

function pointToAnchor(
  point: Point,
  gap = SELECTION_ANCHOR_GAP,
  posLevel: CapturedSelection['selection']['posLevel'] = POSITION_LEVEL.NONE
): SelectionAnchor {
  return { centerX: point.x, top: point.y, bottom: point.y, gap, posLevel }
}

function fitNearSelection(anchor: SelectionAnchor, width: number, height: number): Rectangle {
  const anchorPoint = { x: anchor.centerX, y: anchor.bottom }
  const workArea = screen.getDisplayNearestPoint(anchorPoint).workArea
  const workAreaBottom = workArea.y + workArea.height
  const preferredX = Math.round(anchor.centerX - width / 2)
  const belowY = Math.round(anchor.bottom + anchor.gap)
  const aboveY = Math.round(anchor.top - height - anchor.gap)
  const x = clamp(preferredX, workArea.x, workArea.x + workArea.width - width)
  const spaceBelow = workAreaBottom - belowY
  const spaceAbove = anchor.top - anchor.gap - workArea.y
  const preferredY = spaceBelow >= height || spaceBelow >= spaceAbove ? belowY : aboveY
  const y = clamp(preferredY, workArea.y, workAreaBottom - height)
  return { x, y, width, height }
}

function fitExplanationNearSelection(
  anchor: SelectionAnchor,
  preferredSize: ExplanationSize
): Rectangle {
  const anchorPoint = { x: anchor.centerX, y: anchor.bottom }
  const workArea = screen.getDisplayNearestPoint(anchorPoint).workArea
  const safeLeft = workArea.x + EXPLANATION_SCREEN_MARGIN
  const safeTop = workArea.y + EXPLANATION_SCREEN_MARGIN
  const safeRight = workArea.x + workArea.width - EXPLANATION_SCREEN_MARGIN
  const safeBottom = workArea.y + workArea.height - EXPLANATION_SCREEN_MARGIN
  const availableWidth = Math.max(1, safeRight - safeLeft)
  const availableHeight = Math.max(1, safeBottom - safeTop)
  const width = Math.min(Math.max(preferredSize.width, EXPLANATION_MIN_WIDTH), availableWidth)
  const height = Math.min(Math.max(preferredSize.height, EXPLANATION_MIN_HEIGHT), availableHeight)
  const usesSelectionPosition = hasSelectionPosition(anchor.posLevel)
  const gap = usesSelectionPosition ? EXPLANATION_SELECTION_GAP : MOUSE_ANCHOR_GAP
  const preferredX = Math.round(
    anchor.centerX + (usesSelectionPosition ? 0 : EXPLANATION_POINTER_OFFSET)
  )
  const preferredY = Math.round(anchor.bottom + gap)
  const x = clamp(preferredX, safeLeft, safeRight - width)
  const y = clamp(preferredY, safeTop, safeBottom - height)
  return { x, y, width, height }
}

function hasSelectionPosition(posLevel: CapturedSelection['selection']['posLevel']): boolean {
  return posLevel === POSITION_LEVEL.SEL_FULL || posLevel === POSITION_LEVEL.SEL_DETAILED
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function containsPoint(bounds: Rectangle, point: Point): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  )
}

function insetRectangle(bounds: Rectangle, inset: number): Rectangle {
  return {
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: Math.max(0, bounds.width - inset * 2),
    height: Math.max(0, bounds.height - inset * 2)
  }
}

function getToolbarShadowMargin(): number {
  return process.platform === 'win32' ? SELECTION_TOOLBAR_WINDOWS_SHADOW_MARGIN : 0
}

function decodeEntryTarget(url: string): string {
  const target = url.replace(/^entry:\/\/\/?/i, '').split('#', 1)[0]
  try {
    return decodeURIComponent(target)
  } catch {
    return target
  }
}

function isNavigationAborted(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('ERR_ABORTED')) return true
  if (typeof error !== 'object' || error === null) return false
  const navigationError = error as { code?: unknown; errno?: unknown }
  return navigationError.code === 'ERR_ABORTED' || navigationError.errno === -3
}
