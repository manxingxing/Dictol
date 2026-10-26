import {
  Menu,
  clipboard,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle
} from 'electron'

import type { WebContentsViewManager } from '../web-contents-view-manager'
import {
  createDictionaryAggregateUrl,
  createDictionaryEntryUrl,
  parseDictionaryAggregateUrl,
  parseDictionaryEntryResourceUrl,
  parseDictionaryEntryUrl,
  parseDictionaryEntryNavigation
} from '../dictionary-entry-url'
import { resolveEntryLinkWithAnchor } from '../resolve-entry-link'
import { resolveRendererUrl } from '../output-path'
import { createDictionaryNoteWithImages } from '../service/dictionary-note-image'
import {
  copyContextImageToClipboard,
  convertDictionaryContextImageToPng,
  downloadContextImage,
  readDictionaryContextImage
} from '../lib/dictionary-context-image'
import type {
  DictionaryAggregateRequest,
  DictionaryLookupRequest
} from '../../shared/dictionary-navigation'
import type { DictionaryNoteCreationResultEvent } from '../../shared/dictionary-note'
import { BaseController } from './base-controller'
import { dismissSearchPopover } from './search-popover'

export class DictionaryViewController extends BaseController {
  private static readonly maxAiExplanationTextLength = 10_000
  private loadVersion = 0
  private navigationVersion = 0
  private configuredViewId: number | undefined
  private desiredUrl: string | undefined
  private loadedUrl: string | undefined
  private pendingUrl: string | undefined
  private pendingLoad: Promise<boolean> | undefined
  private lastDictBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }

  override mount(): void {
    void this.activeView
    ipcMain.handle('dictionary-view:show', this.show)
    ipcMain.handle('dictionary-view:show-aggregate', this.showAggregate)
    ipcMain.on('dictionary-view:hide', this.hide)
    ipcMain.on('dictionary-view:scroll-to-dictionary', this.scrollToDictionary)
    ipcMain.on('dictionary-view:active-dictionary', this.activeDictionaryChanged)
    ipcMain.on('dictionary-view:set-bounds', this.setBounds)
    ipcMain.on('dictionary-view:lookup-word', this.lookupWord)
    ipcMain.handle('dictionary-view:can-explain-with-ai', this.canExplainWithAi)
    ipcMain.on('dictionary-view:open-note', this.createNote)
    ipcMain.on('dictionary-view:explain-with-ai', this.explainWithAi)
    ipcMain.handle('dictionary-view:copy-text', this.copyText)
    ipcMain.on('dictionary-view:pointer-down', this.pointerDown)
    ipcMain.on('dictionary-view:show-find-bar', this.showFindBar)
    ipcMain.on('find-bar:find-in-page', this.findInPage)
    ipcMain.on('find-bar:find-next', this.findNext)
    ipcMain.on('find-bar:clear-find', this.clearFind)
    ipcMain.on('find-bar:stop-find', this.stopFind)
  }

  show = async (
    event: IpcMainInvokeEvent,
    target: { dictionaryId: string; term: string; anchor?: string }
  ): Promise<void> => {
    if (!this.acceptsHostSender(event.sender.id)) return
    if (
      !target ||
      typeof target.dictionaryId !== 'string' ||
      typeof target.term !== 'string' ||
      (target.anchor !== undefined && typeof target.anchor !== 'string')
    )
      return
    this.navigationVersion += 1
    await this.showEntry(
      createDictionaryEntryUrl(target.dictionaryId, target.term, { anchor: target.anchor })
    )
  }

  showAggregate = async (
    event: IpcMainInvokeEvent,
    target: DictionaryAggregateRequest
  ): Promise<void> => {
    if (
      !this.acceptsHostSender(event.sender.id) ||
      !target ||
      typeof target.term !== 'string' ||
      (target.dictionaryId !== undefined && typeof target.dictionaryId !== 'string') ||
      (target.anchor !== undefined && typeof target.anchor !== 'string')
    ) {
      return
    }

    const normalizedTerm = target.term.trim()
    if (!normalizedTerm || normalizedTerm.length > 200) return

    // Resolve a recreated view before its load state is updated.
    const view = this.activeView
    this.navigationVersion += 1
    const url = createDictionaryAggregateUrl(normalizedTerm, {
      dictionaryId: target.dictionaryId,
      anchor: target.anchor
    })
    this.desiredUrl = url
    const version = ++this.loadVersion
    this.loadedUrl = undefined
    this.pendingUrl = undefined
    this.pendingLoad = undefined
    this.notifyLoadingState(true)
    view.show()

    try {
      await view.loadURL(url)
      if (this.runtime.isDisposed) return
      if (version !== this.loadVersion || this.desiredUrl !== url) return
      this.loadedUrl = url
      this.notifyLoadingState(false)
      view.show()
    } catch (error) {
      if (this.runtime.isDisposed) return
      if (version !== this.loadVersion || this.desiredUrl !== url) return
      this.notifyLoadingState(false)

      if (!isNavigationAborted(error)) {
        view.hide()
        throw error
      }
    }
  }

  hide = (event: IpcMainEvent): void => {
    if (!this.acceptsHostSender(event.sender.id)) return
    this.navigationVersion += 1
    this.hideView()
  }

  scrollToDictionary = (event: IpcMainEvent, dictionaryId: unknown): void => {
    if (!this.acceptsHostSender(event.sender.id) || this.runtime.dictionaryLayout !== 'aggregate') {
      return
    }

    const numericDictionaryId =
      typeof dictionaryId === 'number' ? dictionaryId : Number(dictionaryId)
    if (!Number.isSafeInteger(numericDictionaryId) || numericDictionaryId <= 0) return

    this.activeView.send('dictionary-view:scroll-to-dictionary', numericDictionaryId)
  }

  activeDictionaryChanged = (event: IpcMainEvent, dictionaryId: unknown): void => {
    if (!this.acceptsViewSender(event.sender.id) || this.runtime.dictionaryLayout !== 'aggregate') {
      return
    }

    const numericDictionaryId =
      typeof dictionaryId === 'number' ? dictionaryId : Number(dictionaryId)
    if (!Number.isSafeInteger(numericDictionaryId) || numericDictionaryId <= 0) return

    this.activeView.sendToMainWindow(
      'dictionary-view:active-dictionary-changed',
      numericDictionaryId
    )
  }

  setBounds = (event: IpcMainEvent, bounds: Rectangle): void => {
    if (!this.acceptsHostSender(event.sender.id) || !isRectangle(bounds)) return
    this.lastDictBounds = bounds
    this.activeView.setBounds(bounds)
    this.syncFindBarBounds()
  }

  lookupWord = (event: IpcMainEvent, word: string): void => {
    if (!this.acceptsViewSender(event.sender.id) || typeof word !== 'string') return
    this.sendLookup({ word })
  }

  canExplainWithAi = (event: IpcMainInvokeEvent): boolean => {
    return this.acceptsViewSender(event.sender.id) && this.runtime.appConfig.load().aiLookup.enabled
  }

  explainWithAi = (event: IpcMainEvent, text: string): void => {
    if (!this.acceptsViewSender(event.sender.id)) return
    this.explainWithAiText(text)
  }

  copyText = async (event: IpcMainInvokeEvent, text: string): Promise<void> => {
    if (
      !this.acceptsViewSender(event.sender.id) ||
      typeof text !== 'string' ||
      !text
    ) {
      return
    }
    await clipboard.writeText(text)
  }

  // 从 context menu创建文本摘抄
  createNote = (event: IpcMainEvent, text: string, sourceDictionaryId?: unknown): void => {
    if (!this.acceptsViewSender(event.sender.id)) return
    void this.createTextNote(text, this.parseSourceDictionaryId(sourceDictionaryId))
  }

  private async createTextNote(text: string, sourceDictionaryId?: number): Promise<void> {
    const normalizedText = typeof text === 'string' ? text.trim() : ''
    if (!normalizedText || normalizedText.length > 100_000) return

    const context = this.getCurrentNoteContext(sourceDictionaryId)
    if (!context) return
    try {
      await this.db.createDictionaryNote({
        relatedTerms: [context.term],
        sourceDictionaryId:
          context.sourceDictionaryId === undefined ? null : String(context.sourceDictionaryId),
        sourceEntryTerm: context.term,
        excerpt: normalizedText
      })
      this.notifyNoteCreated(context.term)
    } catch (error) {
      console.error('Failed to create a dictionary text note', error)
      this.notifyNoteCreationFailed(error, [context.term])
    }
  }

  private notifyNoteCreated(term: string): void {
    const payload: DictionaryNoteCreationResultEvent = { status: 'success', relatedTerms: [term] }
    this.notifyNoteCreationResult(payload)
  }

  private notifyNoteCreationFailed(error: unknown, relatedTerms: string[]): void {
    const payload: DictionaryNoteCreationResultEvent = {
      status: 'fail',
      relatedTerms,
      message: error instanceof Error ? error.message : '摘抄保存失败'
    }
    this.notifyNoteCreationResult(payload)
  }

  private notifyNoteCreationResult(payload: DictionaryNoteCreationResultEvent): void {
    this.runtime.mainWindow?.webContents.send('note-creation-result', payload)
  }

  private explainWithAiText(text: string): void {
    const normalizedText = text.trim()
    if (
      !this.runtime.appConfig.load().aiLookup.enabled ||
      !normalizedText ||
      normalizedText.length > DictionaryViewController.maxAiExplanationTextLength
    ) {
      return
    }
    this.activeView.sendToMainWindow('dictionary-view:explain-with-ai', normalizedText)
  }

  pointerDown = (event: IpcMainEvent): void => {
    if (!this.acceptsViewSender(event.sender.id)) return
    dismissSearchPopover(this.runtime)
  }

  findInPage = (event: IpcMainEvent, text: string): void => {
    if (!this.acceptsFindBarSender(event.sender.id) || typeof text !== 'string' || !text) return
    this.activeView.webContents.findInPage(text, { forward: true })
  }

  findNext = (event: IpcMainEvent, text: string, forward: boolean): void => {
    if (!this.acceptsFindBarSender(event.sender.id) || typeof text !== 'string' || !text) return
    this.activeView.webContents.findInPage(text, { forward: !!forward, findNext: true })
  }

  clearFind = (event: IpcMainEvent): void => {
    if (!this.acceptsFindBarSender(event.sender.id)) return
    this.activeView.webContents.stopFindInPage('clearSelection')
  }

  stopFind = (event: IpcMainEvent): void => {
    if (!this.acceptsFindBarSender(event.sender.id)) return
    this.activeView.webContents.stopFindInPage('clearSelection')
    this.hideFindBarView(true)
  }

  showFindBar = (event: IpcMainEvent): void => {
    if (!this.acceptsViewSender(event.sender.id) && !this.acceptsHostSender(event.sender.id)) return
    this.showFindBarView()
  }

  private async showEntry(url: string): Promise<boolean> {
    const view = this.activeView
    this.desiredUrl = url
    if (this.loadedUrl === url) {
      view.show()
      this.notifyLoadingState(false)
      return true
    }
    if (this.pendingUrl === url && this.pendingLoad) {
      view.show()
      this.notifyLoadingState(true)
      return this.pendingLoad
    }

    const version = ++this.loadVersion
    this.loadedUrl = undefined
    this.notifyLoadingState(true)
    const load = this.loadEntry(view, url, version)
    this.pendingUrl = url
    this.pendingLoad = load

    const clearPendingLoad = (): void => {
      if (this.pendingLoad !== load) return
      this.pendingUrl = undefined
      this.pendingLoad = undefined
    }
    void load.then(clearPendingLoad, clearPendingLoad)
    return load
  }

  // 从当前 view加载的 url -> { term, sourceDictionaryId }
  private getCurrentNoteContext(
    selectedDictionaryId?: number
  ): { term: string; sourceDictionaryId?: number } | null {
    const currentUrl = this.desiredUrl ?? this.loadedUrl
    if (!currentUrl) return null
    // 单词典模式下 term, dictionary id 在 url上
    const entry = parseDictionaryEntryUrl(currentUrl)
    if (entry) return { term: entry.term, sourceDictionaryId: entry.dictionaryId }

    // 聚合模式下，仅有term
    const aggregate = parseDictionaryAggregateUrl(currentUrl)
    if (!aggregate) return null
    return {
      term: aggregate.term,
      sourceDictionaryId: selectedDictionaryId
    }
  }

  private parseSourceDictionaryId(value: unknown): number | undefined {
    const dictionaryId = typeof value === 'number' ? value : Number(value)
    return Number.isSafeInteger(dictionaryId) && dictionaryId > 0 ? dictionaryId : undefined
  }

  // 右键菜单 - 图片
  private async getDictionaryIdAtPoint(
    view: WebContentsViewManager,
    x: number,
    y: number
  ): Promise<number | undefined> {
    const currentUrl = this.desiredUrl ?? this.loadedUrl
    if (!currentUrl || !parseDictionaryAggregateUrl(currentUrl)) return undefined
    const value: unknown = await view.webContents.executeJavaScript(`(() => {
      const element = document.elementFromPoint(${x}, ${y})
      const value = element?.closest('.dictol-dictionary-section')?.getAttribute('data-dictionary-id')
      const dictionaryId = Number(value)
      return Number.isSafeInteger(dictionaryId) && dictionaryId > 0 ? dictionaryId : null
    })()`)
    return this.parseSourceDictionaryId(value)
  }

  // 右键菜单 - 文本
  private async getSelectedDictionaryId(view: WebContentsViewManager): Promise<number | undefined> {
    const currentUrl = this.desiredUrl ?? this.loadedUrl
    if (!currentUrl || !parseDictionaryAggregateUrl(currentUrl)) return undefined
    const value: unknown = await view.webContents.executeJavaScript(`(() => {
      const anchorNode = window.getSelection()?.anchorNode
      const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement
      const value = anchorElement?.closest('.dictol-dictionary-section')?.getAttribute('data-dictionary-id')
      const dictionaryId = Number(value)
      return Number.isSafeInteger(dictionaryId) && dictionaryId > 0 ? dictionaryId : null
    })()`)
    return this.parseSourceDictionaryId(value)
  }

  private hideView(): void {
    this.desiredUrl = undefined
    this.notifyLoadingState(false)
    this.activeView.hide()
    this.hideFindBarView()
  }

  private async loadEntry(
    view: WebContentsViewManager,
    url: string,
    version: number
  ): Promise<boolean> {
    view.show()
    try {
      await view.loadURL(url)
      if (this.runtime.isDisposed) return false
      if (version !== this.loadVersion) return false
      this.loadedUrl = url
      const shouldRemainVisible = this.desiredUrl === url
      this.notifyLoadingState(false)
      if (shouldRemainVisible) view.show()
      else view.hide()
      return shouldRemainVisible
    } catch (error) {
      if (this.runtime.isDisposed) return false
      if (version !== this.loadVersion || this.desiredUrl !== url) {
        return false
      }
      this.notifyLoadingState(false)
      if (isNavigationAborted(error)) return false
      view.hide()
      throw error
    }
  }

  private configureView(view: WebContentsViewManager): void {
    view.webContents.on('context-menu', (event, params) => {
      if (!params.hasImageContents && !params.selectionText.trim()) return
      event.preventDefault()
      this.showContextMenu(view, params)
    })
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url).catch((error: unknown) => {
          console.error('Failed to open dictionary external URL', { url, error })
        })
      }
      return { action: 'deny' }
    })
    // 处理 entry 逻辑跳转
    view.webContents.on('will-navigate', (event) => {
      if (event.url.startsWith('dictol-entry://')) return
      event.preventDefault()
      const navigation = parseDictionaryEntryNavigation(event.url)
      if (navigation) {
        const version = ++this.navigationVersion
        void resolveEntryLinkWithAnchor(navigation, (dictionaryId, term) =>
          this.db.lookupDictionaryEntry(dictionaryId, term)
        ).then(({ request }) => {
          if (version === this.navigationVersion) this.sendLookup(request)
        })
      }
    })
    // 页面内查找
    view.webContents.on('found-in-page', (_event, result) => {
      this.findBarView?.send('find-bar:find-result', result)
    })

    view.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        console.warn('[DictionaryView] failed to load resource', {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame
        })
      }
    )
    // Clear any lingering find highlights when a new entry loads
    view.webContents.on('did-finish-load', () => {
      view.webContents.stopFindInPage('clearSelection')
      this.hideFindBarView()
    })
  }

  private showContextMenu(view: WebContentsViewManager, params: Electron.ContextMenuParams): void {
    const window = this.runtime.mainWindow
    if (!window) return

    if (params.hasImageContents) {
      const menuItems: Electron.MenuItemConstructorOptions[] = [
        {
          label: '复制图片',
          click: () =>
            void copyContextImageToClipboard(view.webContents, params).catch(
              (error: unknown) => console.error('Failed to copy dictionary image', error)
            )
        },
        {
          label: '下载图片',
          click: () =>
            void downloadContextImage(window, view.webContents, params).catch(
              (error: unknown) => console.error('Failed to download dictionary image', error)
            )
        },
        {
          label: '摘抄',
          click: () => void this.createImageNote(view, params)
        }
      ]
      Menu.buildFromTemplate(menuItems).popup({
        window,
        x: Math.round(this.lastDictBounds.x + params.x),
        y: Math.round(this.lastDictBounds.y + params.y)
      })
      return
    }

    const text = params.selectionText.trim()
    if (!text) return

    const menuItems: Electron.MenuItemConstructorOptions[] = [
      {
        label: '复制',
        click: () => {
          void clipboard.writeText(text).catch((error: unknown) => {
            console.error('Failed to copy dictionary text', error)
          })
        }
      },
      {
        label: '查词',
        enabled: text.length <= 200,
        click: () => this.sendLookup({ word: text })
      },
      {
        label: '摘抄',
        click: () => void this.createNoteFromSelection(view, text)
      }
    ]

    if (this.runtime.appConfig.load().aiLookup.enabled) {
      menuItems.push({
        label: 'AI 解释',
        enabled: text.length <= DictionaryViewController.maxAiExplanationTextLength,
        click: () => this.explainWithAiText(text)
      })
    }

    Menu.buildFromTemplate(menuItems).popup({
      window,
      x: Math.round(this.lastDictBounds.x + params.x),
      y: Math.round(this.lastDictBounds.y + params.y)
    })
  }

  private async createImageNote(
    view: WebContentsViewManager,
    params: Electron.ContextMenuParams
  ): Promise<void> {
    let term: string | null = null
    try {
      const selectedDictionaryId =
        parseDictionaryEntryResourceUrl(params.srcURL)?.dictionaryId ??
        (await this.getDictionaryIdAtPoint(view, params.x, params.y))
      const context = this.getCurrentNoteContext(selectedDictionaryId)
      if (!context) return
      term = context.term

      const image = await readDictionaryContextImage(view.webContents, params)
      const png = image && (await convertDictionaryContextImageToPng(image))
      if (!png) throw new Error('无法读取词典图片')

      await createDictionaryNoteWithImages(this.db, {
        relatedTerms: [context.term],
        sourceDictionaryId:
          context.sourceDictionaryId === undefined ? null : String(context.sourceDictionaryId),
        sourceEntryTerm: context.term,
        imageBytes: [new Uint8Array(png)]
      })
      this.notifyNoteCreated(term)
    } catch (error) {
      console.error('Failed to create a dictionary image note', error)
      if (term) {
        this.notifyNoteCreationFailed(error, [term])
      }
    }
  }

  private async createNoteFromSelection(view: WebContentsViewManager, text: string): Promise<void> {
    const context = this.getCurrentNoteContext()
    if (!context) return
    try {
      const selectedDictionaryId = await this.getSelectedDictionaryId(view)
      await this.createTextNote(text, selectedDictionaryId)
    } catch (error) {
      console.error('Failed to resolve the source dictionary for a text note', error)
      this.notifyNoteCreationFailed(error, [context.term])
    }
  }

  private sendLookup(request: DictionaryLookupRequest): void {
    const normalizedWord = request.word.trim()
    if (!normalizedWord) return
    this.activeView.sendToMainWindow('dictionary-view:lookup-word', {
      word: normalizedWord,
      ...(request.sourceDictionaryId ? { sourceDictionaryId: request.sourceDictionaryId } : {}),
      ...(request.anchor ? { anchor: request.anchor } : {})
    })
  }

  private notifyLoadingState(isLoading: boolean): void {
    this.availableActiveView?.sendToMainWindow('dictionary-view:loading-changed', isLoading)
  }

  private acceptsViewSender(senderId: number): boolean {
    return this.availableActiveView?.acceptsSender(senderId) === true
  }

  private acceptsHostSender(senderId: number): boolean {
    return this.availableActiveView?.acceptsHostSender(senderId) === true
  }

  private get availableActiveView(): WebContentsViewManager | undefined {
    const view = this.runtime.activeDictionaryView
    return view && !view.isDestroyed ? view : undefined
  }

  private acceptsFindBarSender(senderId: number): boolean {
    return this.findBarView?.acceptsSender(senderId) === true
  }

  private get findBarView(): WebContentsViewManager | undefined {
    return this.runtime.windowManager.findBarView
  }

  private showFindBarView(): void {
    const dictionaryView = this.activeView
    if (
      !dictionaryView?.isVisible ||
      this.loadedUrl === undefined ||
      this.pendingUrl !== undefined ||
      !hasUsableBounds(this.lastDictBounds)
    ) {
      return
    }

    const findBar = this.runtime.windowManager.createFindBarView()
    this.runtime.mainWindowShortcutRouter?.register(findBar.webContents, 'find-bar')
    const { x, y, width } = this.lastDictBounds
    findBar.setBounds({
      x: Math.max(0, x + width - 300),
      y,
      width: 300,
      height: 44
    })
    const hasLoadedFindBar = findBar.getURL() !== ''
    if (!hasLoadedFindBar && !findBar.webContents.isLoading()) {
      const loadPromise = findBar.loadURL(resolveRendererUrl('find-bar.html'))
      void loadPromise.catch((error: unknown) => {
        console.error('Failed to load find bar', error)
      })
    }
    findBar.show()
    findBar.webContents.focus()
    if (hasLoadedFindBar) findBar.send('find-bar:activate')
  }

  private hideFindBarView(restoreFocus = false): void {
    this.findBarView?.hide()
    if (restoreFocus) this.runtime.windowManager.focusMainWindowRenderer()
  }

  private syncFindBarBounds(): void {
    const findBar = this.findBarView
    if (!findBar?.isVisible || !hasUsableBounds(this.lastDictBounds)) return
    const { x, y, width } = this.lastDictBounds
    findBar.setBounds({
      x: Math.max(0, x + width - 300),
      y,
      width: 300,
      height: 44
    })
  }

  private get activeView(): WebContentsViewManager {
    const view = this.runtime.activeDictionaryView
    if (!view || view.isDestroyed) {
      throw new Error('DictionaryView 尚未初始化')
    }
    if (this.configuredViewId !== view.webContents.id) {
      this.loadVersion += 1
      this.navigationVersion += 1
      this.desiredUrl = undefined
      this.loadedUrl = undefined
      this.pendingUrl = undefined
      this.pendingLoad = undefined
      this.configureView(view)
      this.configuredViewId = view.webContents.id
    }
    return view
  }
}

function hasUsableBounds(bounds: Rectangle): boolean {
  return bounds.width > 0 && bounds.height > 0
}

function isRectangle(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false
  const rectangle = value as Partial<Rectangle>
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(
    (part) => typeof part === 'number' && Number.isFinite(part) && part >= 0
  )
}

function isNavigationAborted(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('ERR_ABORTED')) return true
  if (typeof error !== 'object' || error === null) return false
  const navigationError = error as { code?: unknown; errno?: unknown }
  return navigationError.code === 'ERR_ABORTED' || navigationError.errno === -3
}
