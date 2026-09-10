import {
  clipboard,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle
} from 'electron'

import type { WebContentsViewManager } from '../web-contents-view-manager'
import { createDictionaryAggregateUrl, createDictionaryEntryUrl } from '../dictionary-entry-url'
import { resolveRendererUrl } from '../output-path'
import { BaseController } from './base-controller'
import { dismissSearchPopover } from './search-popover'

export class DictionaryViewController extends BaseController {
  private static readonly maxAiExplanationTextLength = 10_000
  private loadVersion = 0
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
    ipcMain.on('dictionary-view:explain-with-ai', this.explainWithAi)
    ipcMain.on('dictionary-view:copy-text', this.copyText)
    ipcMain.on('dictionary-view:pointer-down', this.pointerDown)
    ipcMain.on('dictionary-view:show-find-bar', this.showFindBar)
    ipcMain.on('find-bar:find-in-page', this.findInPage)
    ipcMain.on('find-bar:find-next', this.findNext)
    ipcMain.on('find-bar:clear-find', this.clearFind)
    ipcMain.on('find-bar:stop-find', this.stopFind)
  }

  show = async (
    event: IpcMainInvokeEvent,
    target: { dictionaryId: string; term: string }
  ): Promise<void> => {
    if (!this.acceptsHostSender(event.sender.id)) return
    if (!target || typeof target.dictionaryId !== 'string' || typeof target.term !== 'string')
      return
    await this.showEntry(createDictionaryEntryUrl(target.dictionaryId, target.term))
  }

  showAggregate = async (event: IpcMainInvokeEvent, term: string): Promise<void> => {
    if (!this.acceptsHostSender(event.sender.id) || typeof term !== 'string') return

    const normalizedTerm = term.trim()
    if (!normalizedTerm || normalizedTerm.length > 200) return

    const url = createDictionaryAggregateUrl(normalizedTerm)
    this.desiredUrl = url
    const version = ++this.loadVersion
    this.loadedUrl = undefined
    this.pendingUrl = undefined
    this.pendingLoad = undefined
    this.notifyLoadingState(true)
    this.activeView.show()

    try {
      await this.activeView.loadURL(url)
      if (this.runtime.isDisposed) return
      if (version !== this.loadVersion || this.desiredUrl !== url) return
      this.loadedUrl = url
      this.notifyLoadingState(false)
      this.activeView.show()
    } catch (error) {
      if (this.runtime.isDisposed) return
      if (version !== this.loadVersion || this.desiredUrl !== url) return
      this.notifyLoadingState(false)
      this.activeView.hide()
      if (!isNavigationAborted(error)) throw error
    }
  }

  hide = (event: IpcMainEvent): void => {
    if (!this.acceptsHostSender(event.sender.id)) return
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
    this.sendLookup(word)
  }

  canExplainWithAi = (event: IpcMainInvokeEvent): boolean => {
    return this.acceptsViewSender(event.sender.id) && this.runtime.appConfig.load().aiLookup.enabled
  }

  explainWithAi = (event: IpcMainEvent, text: string): void => {
    const normalizedText = text.trim()
    if (
      !this.acceptsViewSender(event.sender.id) ||
      !this.runtime.appConfig.load().aiLookup.enabled ||
      !normalizedText ||
      normalizedText.length > DictionaryViewController.maxAiExplanationTextLength
    ) {
      return
    }
    this.activeView.sendToMainWindow('dictionary-view:explain-with-ai', normalizedText)
  }

  copyText = (event: IpcMainEvent, text: string): void => {
    if (
      !this.acceptsViewSender(event.sender.id) ||
      typeof text !== 'string' ||
      !text ||
      text.length > 100_000
    ) {
      return
    }
    clipboard.writeText(text)
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
    this.desiredUrl = url
    if (this.loadedUrl === url) {
      this.activeView.show()
      this.notifyLoadingState(false)
      return true
    }
    if (this.pendingUrl === url && this.pendingLoad) {
      this.activeView.show()
      this.notifyLoadingState(true)
      return this.pendingLoad
    }

    const version = ++this.loadVersion
    this.loadedUrl = undefined
    this.notifyLoadingState(true)
    const load = this.loadEntry(url, version)
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

  private hideView(): void {
    this.desiredUrl = undefined
    this.notifyLoadingState(false)
    this.activeView.hide()
    this.hideFindBarView()
  }

  private async loadEntry(url: string, version: number): Promise<boolean> {
    this.activeView.show()
    try {
      await this.activeView.loadURL(url)
      if (this.runtime.isDisposed) return false
      if (version !== this.loadVersion) return false
      this.loadedUrl = url
      const shouldRemainVisible = this.desiredUrl === url
      this.notifyLoadingState(false)
      if (shouldRemainVisible) this.activeView.show()
      else this.activeView.hide()
      return shouldRemainVisible
    } catch (error) {
      if (this.runtime.isDisposed) return false
      if (version !== this.loadVersion || this.desiredUrl !== url) {
        return false
      }
      this.notifyLoadingState(false)
      if (isNavigationAborted(error)) return false
      this.activeView.hide()
      throw error
    }
  }

  private configureView(view: WebContentsViewManager): void {
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
      if (event.url.startsWith('entry://')) this.sendLookup(decodeEntryTarget(event.url))
    })
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

  private sendLookup(word: string): void {
    const normalizedWord = word.trim()
    if (!normalizedWord || normalizedWord.length > 200) return
    this.activeView.sendToMainWindow('dictionary-view:lookup-word', normalizedWord)
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
