import {
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Point
} from 'electron'
import type { DictionaryMatch } from '../db-service'
import type {
  SelectionExplanationDictionary,
  SelectionExplanationPayload
} from '../../shared/selection-explanation'
import type { WebContentsViewManager } from '../web-contents-view-manager'
import { readDictionaryContextImage } from '../lib/dictionary-context-image'
import { createDictionaryNoteWithImages } from '../service/dictionary-note-image'
import type { DictionaryNoteCreationResultEvent } from '../../shared/dictionary-note'
import {
  createDictionaryEntryUrl,
  parseDictionaryEntryNavigation,
  parseDictionaryEntryUrl
} from '../dictionary-entry-url'
import { resolveEntryLinkWithAnchor } from '../resolve-entry-link'
import { resolveRendererUrl } from '../output-path'
import { hideSelectionWindow, showSelectionWindowInactive } from '../selection-window-behavior'
import type { SelectionSurfaceWindow } from '../window-manager'
import type { OcrSelection } from '../ocr/ocr-text'
import {
  containsPoint,
  createCursorAnchor,
  fitExplanationNearSelection,
  type SelectionAnchor
} from '../lib/selection-position'
import { BaseController } from './base-controller'

const MAX_SELECTION_LENGTH = 200
const EXPLANATION_MIN_WIDTH = 360
const EXPLANATION_MIN_HEIGHT = 300

type ExplanationSize = { width: number; height: number }
type PendingExplanationLoading = { requestId: number; resolve: () => void }

export class SelectionExplanationController extends BaseController {
  private anchor: SelectionAnchor | undefined
  private explanationWebContentsId: number | undefined
  private explanationLoaded = false
  private explanationPayload: SelectionExplanationPayload | undefined
  private explanationDictionaryMatches: DictionaryMatch[] = []
  private loadedExplanationDictionaryId: string | undefined
  private pendingExplanationLoading: PendingExplanationLoading | undefined
  private lookupVersion = 0
  private preferredExplanationSize: ExplanationSize = { width: 520, height: 600 }
  private preferredOcrAiSize: ExplanationSize = { width: 520, height: 320 }
  private appliedExplanationSize: ExplanationSize | undefined
  private activeAiRequestId: string | undefined
  private onVisibilityChange: (() => void) | undefined

  setOnVisibilityChange(callback: () => void): void {
    this.onVisibilityChange = callback
  }

  override mount(): void {
    ipcMain.on('selection-explanation:select-dictionary', this.selectExplanationDictionary)
    ipcMain.on('selection-explanation:lookup-word', this.lookupFromExplanation)
    ipcMain.on('selection-explanation:show-ai', this.showAiFromExplanation)
    ipcMain.on('selection-explanation:copy-text', this.copyFromExplanation)
    ipcMain.handle('selection-explanation:can-create-note', this.canCreateNote)
    ipcMain.on('selection-explanation:create-note', this.createNote)
    ipcMain.handle('selection-explanation:is-starred', this.isWordStarred)
    ipcMain.handle('selection-explanation:toggle-star', this.toggleWordStar)
    ipcMain.handle('selection-explanation:save-ai-explanation', this.saveAiExplanationAsNote)
    ipcMain.handle('selection-explanation:save-ocr-explanation', this.saveOcrExplanationAsExcerpt)
  }

  setAnchor(anchor: SelectionAnchor): void {
    this.anchor = anchor
  }

  get isVisible(): boolean {
    return Boolean(this.currentWindow?.isVisible())
  }

  get currentLookup(): { word: string; dictionaryId?: string } | null {
    const payload = this.explanationPayload
    if (!payload) return null
    const word = payload.word.trim()
    if (!word) return null
    return {
      word,
      dictionaryId: payload.mode === 'dictionary' ? payload.activeDictionaryId : undefined
    }
  }

  setPinned(pinned: boolean): void {
    if (!this.explanationPayload) return
    this.explanationPayload = { ...this.explanationPayload, pinned }
    this.flushExplanationPayload()
  }

  prepareForOcrCapture(): void {
    this.lookupVersion += 1
    this.cancelAiExplanation()
    this.resolvePendingExplanationLoading()
    const window = this.currentWindow
    if (window?.isVisible()) hideSelectionWindow(window)
  }

  hideIfOutside(point: Point): void {
    const window = this.currentWindow
    if (
      window?.isVisible() &&
      !this.runtime.windowManager.isSelectionExplanationPinned() &&
      !containsPoint(window.getBounds(), point)
    ) {
      this.hideExplanation()
    }
  }

  private readonly showAiFromExplanation = (event: IpcMainEvent): void => {
    if (!this.acceptsExplanationSender(event)) return
    const payload = this.explanationPayload
    if (
      payload?.mode !== 'dictionary' ||
      !payload.word.trim() ||
      !this.runtime.appConfig.load().aiLookup.enabled
    ) {
      return
    }
    this.showAiExplanation(payload.word)
  }

  private readonly saveAiExplanationAsNote = async (
    event: IpcMainInvokeEvent,
    commentRich: unknown
  ): Promise<void> => {
    const payload = this.explanationPayload
    if (
      !this.acceptsExplanationSender(event) ||
      payload?.mode !== 'ai' ||
      payload.state !== 'content' ||
      payload.complete !== true ||
      this.activeAiRequestId ||
      typeof commentRich !== 'string'
    ) {
      throw new Error('AI 解释尚未完成，暂时无法保存。')
    }

    const word = payload.word.trim()
    if (!word || !payload.content?.trim()) throw new Error('没有可保存的单词或 AI 解释。')

    await this.db.createDictionaryNote({
      relatedTerms: [word],
      commentRich
    })
    this.notifyNoteCreated([word])
  }

  private readonly saveOcrExplanationAsExcerpt = async (
    event: IpcMainInvokeEvent,
    requestId: unknown
  ): Promise<void> => {
    const payload = this.explanationPayload
    if (
      !this.acceptsExplanationSender(event) ||
      payload?.mode !== 'ocr-ai' ||
      payload.requestId !== requestId ||
      payload.state !== 'content' ||
      !payload.ocrSentence ||
      !payload.ocrExplanation
    ) {
      throw new Error('OCR AI 解释尚未完成。')
    }
    const explanation = payload.ocrExplanation
    await this.db.createDictionaryNote({
      relatedTerms: [payload.word],
      excerpt: payload.ocrSentence,
      comment: [
        `句意：${explanation.sentenceMeaning}`,
        `${payload.word}：${explanation.wordMeaning}`,
        explanation.usage ? `用法：${explanation.usage}` : ''
      ]
        .filter(Boolean)
        .join('\n'),
      commentRich: null
    })
    this.notifyNoteCreated([payload.word])
  }

  markLoadingReady(requestId: number): void {
    if (
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

  private switchExplanationDictionary(
    direction: 'left' | 'right',
    dictionaryId: string,
    url: string
  ): void {
    const payload = this.explanationPayload
    if (
      payload?.mode !== 'dictionary' ||
      payload.state !== 'content' ||
      url !== this.runtime.windowManager.selectionExplanationView?.getURL() ||
      dictionaryId !== payload.activeDictionaryId ||
      dictionaryId !== this.loadedExplanationDictionaryId
    ) {
      return
    }
    const index = this.explanationDictionaryMatches.findIndex(
      (match) => match.dictionaryId === dictionaryId
    )
    const next = this.explanationDictionaryMatches[index + (direction === 'right' ? 1 : -1)]
    if (next) void this.showExplanationDictionary(next)
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
    if (
      (!this.acceptsExplanationSender(event) && !this.acceptsExplanationViewSender(event)) ||
      typeof word !== 'string'
    ) {
      return
    }
    const normalizedWord = word.trim()
    if (!normalizedWord || normalizedWord.length > MAX_SELECTION_LENGTH) return
    const sourceDictionaryId =
      this.explanationPayload?.mode === 'dictionary'
        ? this.explanationPayload.activeDictionaryId
        : undefined
    void this.showExplanation(normalizedWord, sourceDictionaryId, undefined, false)
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

  private readonly canCreateNote = (event: IpcMainInvokeEvent): boolean =>
    this.acceptsExplanationViewSender(event) && this.getCurrentNoteContext() !== null

  private readonly createNote = (event: IpcMainEvent, text: unknown): void => {
    if (!this.acceptsExplanationViewSender(event)) return
    void this.createTextNote(text)
  }

  private getCurrentNoteContext(): { term: string; dictionaryId: number; url: string } | null {
    const payload = this.explanationPayload
    const view = this.runtime.windowManager.selectionExplanationView
    if (
      payload?.mode !== 'dictionary' ||
      payload.state !== 'content' ||
      !this.currentWindow?.isVisible() ||
      !view?.isVisible ||
      view.isDestroyed
    ) {
      return null
    }
    const url = view.getURL()
    const entry = parseDictionaryEntryUrl(url)
    if (
      !entry ||
      entry.term !== payload.word ||
      String(entry.dictionaryId) !== payload.activeDictionaryId ||
      String(entry.dictionaryId) !== this.loadedExplanationDictionaryId
    ) {
      return null
    }
    return { term: entry.term, dictionaryId: entry.dictionaryId, url }
  }

  private async createTextNote(text: unknown): Promise<void> {
    const excerpt = typeof text === 'string' ? text.trim() : ''
    const context = this.getCurrentNoteContext()
    if (!context || !excerpt || excerpt.length > 100_000) return
    try {
      await this.db.createDictionaryNote({
        relatedTerms: [context.term],
        sourceDictionaryId: String(context.dictionaryId),
        sourceEntryTerm: context.term,
        excerpt
      })
      this.notifyNoteCreated([context.term])
      this.showEntryToast(context.url, '摘抄已保存')
    } catch (error) {
      console.error('Failed to create a selection explanation text note', error)
      this.showEntryToast(context.url, '摘抄保存失败')
    }
  }

  private async createImageNote(
    view: WebContentsViewManager,
    params: Electron.ContextMenuParams
  ): Promise<void> {
    const context = this.getCurrentNoteContext()
    if (!context) return
    try {
      const bytes = await readDictionaryContextImage(view.webContents, params)
      if (!bytes) throw new Error('无法读取词典图片')
      await createDictionaryNoteWithImages(this.db, {
        relatedTerms: [context.term],
        sourceDictionaryId: String(context.dictionaryId),
        sourceEntryTerm: context.term,
        imageBytes: [new Uint8Array(bytes)]
      })
      this.notifyNoteCreated([context.term])
      this.showEntryToast(context.url, '摘抄已保存')
    } catch (error) {
      console.error('Failed to create a selection explanation image note', error)
      this.showEntryToast(context.url, '摘抄保存失败')
    }
  }

  private notifyNoteCreated(relatedTerms: string[]): void {
    const payload: DictionaryNoteCreationResultEvent = { status: 'success', relatedTerms }
    this.runtime.mainWindow?.webContents.send('note-creation-result', payload)
  }

  private showEntryToast(url: string, message: string): void {
    const view = this.runtime.windowManager.selectionExplanationView
    if (!view || view.isDestroyed || !view.isVisible || view.getURL() !== url) return
    void view.webContents
      .executeJavaScript(`window.dictolShowToast?.(${JSON.stringify(message)})`)
      .catch((error: unknown) => console.error('Failed to show entry toast', error))
  }

  private showContextMenu(view: WebContentsViewManager, params: Electron.ContextMenuParams): void {
    const window = this.currentWindow
    if (!(window instanceof BrowserWindow)) return
    const context = this.getCurrentNoteContext()
    if (!context) return
    let items: Electron.MenuItemConstructorOptions[]
    if (params.hasImageContents) {
      items = [
        {
          label: '复制',
          click: () => void this.copyImageToClipboard(view, params)
        },
        {
          label: '摘抄',
          click: () => void this.createImageNote(view, params)
        }
      ]
    } else {
      const text = params.selectionText.trim()
      if (!text || text.length > 100_000) return
      items = [
        { label: '复制', click: () => clipboard.writeText(text) },
        {
          label: '查词',
          enabled: text.length <= MAX_SELECTION_LENGTH,
          click: () =>
            void this.showExplanation(text, String(context.dictionaryId), undefined, false)
        },
        { label: '摘抄', click: () => void this.createTextNote(text) }
      ]
    }
    const bounds = view.getBounds()
    Menu.buildFromTemplate(items).popup({
      window,
      x: Math.round(bounds.x + params.x),
      y: Math.round(bounds.y + params.y)
    })
  }

  private async copyImageToClipboard(
    view: WebContentsViewManager,
    params: Electron.ContextMenuParams
  ): Promise<void> {
    const bytes = await readDictionaryContextImage(view.webContents, params)
    if (bytes) clipboard.writeImage(nativeImage.createFromBuffer(bytes))
    else view.webContents.copyImageAt(params.x, params.y)
  }

  private initializeExplanationWindow(): SelectionSurfaceWindow {
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
    window.on('hide', () => {
      this.runtime.windowManager.hideOcrHighlight()
      this.onVisibilityChange?.()
    })
    window.on('closed', () => {
      this.runtime.windowManager.hideOcrHighlight()
      this.onVisibilityChange?.()
    })
    window.webContents.on('did-finish-load', () => {
      this.explanationLoaded = true
      this.flushExplanationPayload()
      if (
        this.explanationPayload?.requestId === this.lookupVersion &&
        (this.explanationPayload.mode === 'ai' ||
          this.explanationPayload.mode === 'ocr-ai' ||
          this.explanationPayload.state === 'error')
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

  prewarmExplanationWindow(): void {
    if (this.currentWindow) return
    setImmediate(() => {
      try {
        this.initializeExplanationWindow()
      } catch (error) {
        console.error('Failed to prewarm selection explanation window', error)
      }
    })
  }

  private showExplanationWindow(window: SelectionSurfaceWindow): void {
    showSelectionWindowInactive(window)
    this.onVisibilityChange?.()
  }

  private configureExplanationView(): void {
    const view = this.explanationView
    view.webContents.on('context-menu', (event, params) => {
      if (!params.hasImageContents && !params.selectionText.trim()) return
      event.preventDefault()
      this.showContextMenu(view, params)
    })
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'Escape') {
        event.preventDefault()
        this.hideExplanation()
        return
      }

      const usesPlatformModifier =
        process.platform === 'darwin' ? input.meta && !input.control : input.control
      if (!usesPlatformModifier || input.alt || input.shift) return

      const key = input.key.toLowerCase()
      if (key !== 'arrowleft' && key !== 'arrowright') return
      const url = view.webContents.getURL()
      const entry = parseDictionaryEntryUrl(url)
      if (this.explanationPayload?.mode !== 'dictionary' || !entry) return

      event.preventDefault()
      this.switchExplanationDictionary(
        key === 'arrowleft' ? 'left' : 'right',
        String(entry.dictionaryId),
        url
      )
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
      const navigation = parseDictionaryEntryNavigation(event.url)
      if (navigation) {
        const version = ++this.lookupVersion
        void resolveEntryLinkWithAnchor(navigation, (dictionaryId, term) =>
          this.db.lookupDictionaryEntry(dictionaryId, term)
        ).then(({ request }) => {
          if (version === this.lookupVersion) {
            this.showExplanation(request.word, request.sourceDictionaryId, request.anchor)
          }
        })
      }
    })
  }

  async showExplanation(
    word: string,
    sourceDictionaryId?: string,
    anchor?: string,
    positionWindow = true
  ): Promise<void> {
    const normalizedWord = word.trim()
    if (!normalizedWord || normalizedWord.length > MAX_SELECTION_LENGTH) return

    this.runtime.windowManager.hideOcrHighlight()
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
    if (positionWindow) this.positionExplanation(window)

    try {
      const lookupPromise = this.db.lookupDictionaryEntryGroup(
        normalizedWord,
        this.runtime.selectionDictionaryGroupId
      )
      await loadingReady
      if (version !== this.lookupVersion) return
      if (!keepWindowVisible) this.showExplanationWindow(window)

      const group = await lookupPromise
      if (version !== this.lookupVersion) return
      const matches = group?.dictionaries ?? []
      const firstMatch =
        matches.find((match) => match.dictionaryId === sourceDictionaryId) ?? matches[0]
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

      this.explanationDictionaryMatches = matches
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
      if (version !== this.lookupVersion) return
      await this.loadExplanationEntry(
        firstMatch.dictionaryId,
        firstMatch.dictionaryName,
        normalizedWord,
        version,
        dictionaries,
        true,
        anchor
      )
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

    this.runtime.windowManager.hideOcrHighlight()
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
    if (this.explanationLoaded && !window.isVisible()) this.showExplanationWindow(window)

    let content = ''
    this.runtime.aiLookupService.start(
      requestId,
      [{ role: 'user', content: normalizedWord }],
      'sidebar',
      (event) => {
        if (
          (event.type === 'done' || event.type === 'error') &&
          this.activeAiRequestId === requestId
        ) {
          this.activeAiRequestId = undefined
        }
        if (version !== this.lookupVersion) return
        if (event.type === 'delta') {
          content += event.text
          this.updateExplanation({
            mode: 'ai',
            requestId: version,
            word: normalizedWord,
            state: 'content',
            content,
            complete: false
          })
        } else if (event.type === 'done') {
          this.updateExplanation({
            mode: 'ai',
            requestId: version,
            word: normalizedWord,
            state: 'content',
            content,
            complete: true
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
      { sourceText: normalizedWord }
    )
  }

  showOcrError(mode: 'dictionary' | 'ai', message: string): void {
    this.runtime.windowManager.hideOcrHighlight()
    this.resolvePendingExplanationLoading()
    this.cancelAiExplanation()
    this.explanationDictionaryMatches = []
    this.loadedExplanationDictionaryId = undefined
    this.runtime.windowManager.setSelectionExplanationSwitcherVisible(false)
    const version = ++this.lookupVersion
    const window = this.initializeExplanationWindow()
    this.explanationView.hide()
    this.updateExplanation({
      mode: mode === 'ai' ? 'ocr-ai' : 'dictionary',
      requestId: version,
      word: '',
      state: 'error',
      message
    })
    this.positionExplanation(window)
    if (this.explanationLoaded) this.showExplanationWindow(window)
  }

  beginOcrAiRecognition(): number {
    this.runtime.windowManager.hideOcrHighlight()
    this.resolvePendingExplanationLoading()
    this.cancelAiExplanation()
    this.explanationDictionaryMatches = []
    this.loadedExplanationDictionaryId = undefined
    this.runtime.windowManager.setSelectionExplanationSwitcherVisible(false)
    const version = ++this.lookupVersion
    const window = this.initializeExplanationWindow()
    this.explanationView.hide()
    this.updateExplanation({
      mode: 'ocr-ai',
      requestId: version,
      word: '',
      state: 'loading'
    })
    this.positionExplanation(window)
    if (this.explanationLoaded) this.showExplanationWindow(window)
    return version
  }

  isOcrAiRecognitionCurrent(version: number): boolean {
    return (
      version === this.lookupVersion &&
      this.explanationPayload?.mode === 'ocr-ai' &&
      this.explanationPayload.state === 'loading'
    )
  }

  showOcrAiRecognitionError(version: number, message: string): void {
    if (!this.isOcrAiRecognitionCurrent(version)) return
    this.updateExplanation({
      mode: 'ocr-ai',
      requestId: version,
      word: '',
      state: 'error',
      message
    })
    const window = this.currentWindow
    if (window && this.explanationLoaded && !window.isVisible()) {
      this.showExplanationWindow(window)
    }
  }

  async showOcrAiExplanation(selection: OcrSelection, version: number): Promise<void> {
    if (!this.isOcrAiRecognitionCurrent(version)) return
    const requestId = `ocr-${version}`
    this.activeAiRequestId = requestId
    const basePayload = {
      mode: 'ocr-ai' as const,
      requestId: version,
      word: selection.word,
      ocrSentence: selection.sentence,
      ocrContext: selection.context
    }
    this.updateExplanation({ ...basePayload, state: 'loading' })

    try {
      const explanation = await this.runtime.aiLookupService.explainOcrContext(requestId, selection)
      if (version !== this.lookupVersion) return
      this.updateExplanation({
        ...basePayload,
        state: 'content',
        ocrExplanation: explanation,
        complete: true
      })
    } catch (error) {
      if (version !== this.lookupVersion) return
      this.updateExplanation({
        ...basePayload,
        state: 'error',
        message: error instanceof Error ? error.message : 'AI 解释失败。'
      })
    } finally {
      if (this.activeAiRequestId === requestId) this.activeAiRequestId = undefined
    }
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
      if (version !== this.lookupVersion) return
      await this.loadExplanationEntry(
        match.dictionaryId,
        match.dictionaryName,
        word,
        version,
        dictionaries,
        false
      )
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
    dictionaryId: string,
    dictionaryName: string,
    word: string,
    version: number,
    dictionaries: SelectionExplanationDictionary[],
    recordQuery: boolean,
    anchor?: string
  ): Promise<void> {
    const view = this.explanationView
    const url = createDictionaryEntryUrl(dictionaryId, word, { anchor })
    let shown = false
    const showLoadedEntry = (): void => {
      if (shown || version !== this.lookupVersion || view.webContents.getURL() !== url) return
      shown = true
      this.updateExplanation({
        mode: 'dictionary',
        requestId: version,
        word,
        dictionaryName,
        dictionaries,
        activeDictionaryId: dictionaryId,
        state: 'content'
      })
      view.show()
      this.loadedExplanationDictionaryId = dictionaryId
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
    this.explanationPayload = {
      ...payload,
      aiEnabled:
        payload.mode === 'dictionary' ? this.runtime.appConfig.load().aiLookup.enabled : undefined,
      pinned: this.runtime.windowManager.isSelectionExplanationPinned()
    }
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
    const window = this.currentWindow
    if (!window || !this.explanationLoaded || !this.explanationPayload) return
    window.webContents.send('selection-explanation:update', this.explanationPayload)
  }

  private positionExplanation(window: SelectionSurfaceWindow): void {
    if (this.runtime.windowManager.isSelectionExplanationPinned()) return
    const anchor = this.anchor ?? createCursorAnchor()
    const preferredSize =
      this.explanationPayload?.mode === 'ocr-ai'
        ? this.preferredOcrAiSize
        : this.preferredExplanationSize
    const bounds = fitExplanationNearSelection(anchor, preferredSize)
    this.appliedExplanationSize = { width: bounds.width, height: bounds.height }
    window.setBounds(bounds, false)
  }

  private rememberExplanationSize(window: SelectionSurfaceWindow): void {
    if (window.isDestroyed()) return
    const [width, height] = window.getSize()
    const appliedSize = this.appliedExplanationSize
    this.appliedExplanationSize = undefined
    if (appliedSize?.width === width && appliedSize.height === height) return
    const preferredSize = {
      width: Math.max(EXPLANATION_MIN_WIDTH, width),
      height: Math.max(EXPLANATION_MIN_HEIGHT, height)
    }
    if (this.explanationPayload?.mode === 'ocr-ai') {
      this.preferredOcrAiSize = preferredSize
    } else {
      this.preferredExplanationSize = preferredSize
    }
  }

  hideExplanation(): void {
    this.runtime.windowManager.hideOcrHighlight()
    this.lookupVersion += 1
    this.cancelAiExplanation()
    this.resolvePendingExplanationLoading()
    this.explanationDictionaryMatches = []
    this.loadedExplanationDictionaryId = undefined
    this.runtime.windowManager.resetSelectionExplanationPinned()
    this.runtime.windowManager.setSelectionExplanationSwitcherVisible(false)
    const window = this.currentWindow
    if (window?.isVisible()) {
      hideSelectionWindow(window)
    } else {
      this.onVisibilityChange?.()
    }
  }

  private cancelAiExplanation(): void {
    if (!this.activeAiRequestId) return
    this.runtime.aiLookupService.cancel(this.activeAiRequestId)
    this.activeAiRequestId = undefined
  }

  private acceptsExplanationSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const window = this.currentWindow
    return Boolean(window && window.webContents.id === event.sender.id)
  }

  private getCurrentExplanationWord(
    event: IpcMainEvent | IpcMainInvokeEvent,
    word: unknown
  ): string | undefined {
    if (!this.acceptsExplanationSender(event) || typeof word !== 'string') return undefined
    const normalizedWord = word.trim()
    if (!normalizedWord || normalizedWord.length > MAX_SELECTION_LENGTH) return undefined
    const payload = this.explanationPayload
    if (!payload || payload.word.trim() !== normalizedWord) return undefined
    if (payload.mode === 'ai') return normalizedWord
    return payload.mode === 'dictionary' && payload.state === 'content' ? normalizedWord : undefined
  }

  private acceptsExplanationViewSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const view = this.runtime.windowManager.selectionExplanationView
    return Boolean(view && !view.isDestroyed && view.acceptsSender(event.sender.id))
  }

  get currentWindow(): SelectionSurfaceWindow | undefined {
    const window = this.runtime.windowManager.selectionExplanationWindow
    return window && !window.isDestroyed() ? window : undefined
  }

  private get explanationView(): WebContentsViewManager {
    const view = this.runtime.windowManager.selectionExplanationView
    if (!view || view.isDestroyed) throw new Error('SelectionExplanationView 尚未初始化')
    return view
  }
}

function isNavigationAborted(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('ERR_ABORTED')) return true
  if (typeof error !== 'object' || error === null) return false
  const navigationError = error as { code?: unknown; errno?: unknown }
  return navigationError.code === 'ERR_ABORTED' || navigationError.errno === -3
}
