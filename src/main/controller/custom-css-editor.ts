import {
  ipcMain,
  nativeTheme,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle
} from 'electron'

import type {
  CustomCssEditorBounds,
  CustomCssEditorDictionary,
  CustomCssEditorSearchResult,
  CustomCssEditorTheme
} from '../../shared/custom-css-editor'
import {
  createDictionaryEntryUrl,
  parseDictionaryEntryNavigation,
  parseDictionaryEntryUrl
} from '../dictionary-entry-url'
import { resolveEntryLinkWithAnchor } from '../resolve-entry-link'
import { resolveRendererUrl } from '../output-path'
import { BaseController } from './base-controller'
import type { DictionaryLookupRequest } from '../../shared/dictionary-navigation'

const MAX_CUSTOM_CSS_LENGTH = 200_000

export class CustomCssEditorController extends BaseController {
  private activeDictionaryId: string | null = null
  // 用于替换 css 的 identifer
  private previewCssKey: string | undefined
  private currentPreviewCss = ''
  private previewCssTask: Promise<void> = Promise.resolve()
  private configuredPreviewId: number | undefined
  private previewNavigationVersion = 0
  private previewTheme: CustomCssEditorTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  private previewThemeTask: Promise<void> = Promise.resolve()
  private previewReady = false

  override mount(): void {
    ipcMain.handle('dictionaries:open-custom-css-editor', this.openCSSEditor)
    ipcMain.handle('custom-css-editor:get-dictionary', this.getDictionary)
    ipcMain.handle('custom-css-editor:search-entry', this.searchEntry)
    ipcMain.on('custom-css-editor:set-preview-bounds', this.setPreviewBounds)
    ipcMain.on('custom-css-editor:set-preview-theme', this.setPreviewTheme)
    ipcMain.on('custom-css-editor:open-devtools', this.openDevTools)
    ipcMain.on('custom-css-editor:preview-css', this.previewCss)
    ipcMain.handle('custom-css-editor:save', this.save)
  }

  openCSSEditor = async (event: IpcMainInvokeEvent, dictionaryId: string): Promise<void> => {
    if (!this.acceptsMainSender(event.sender) || typeof dictionaryId !== 'string') return

    const editorUrl = new URL(resolveRendererUrl('custom-css-editor.html'))
    editorUrl.searchParams.set('dictionaryId', dictionaryId)
    const existingWindow = this.runtime.windowManager.customCssEditorWindow
    if (
      existingWindow &&
      !existingWindow.isDestroyed() &&
      this.activeDictionaryId === dictionaryId &&
      existingWindow.webContents.getURL() === editorUrl.href
    ) {
      existingWindow.show()
      existingWindow.focus()
      return
    }

    const version = ++this.previewNavigationVersion
    const dictionary = await this.db.getDictionary(dictionaryId)
    if (version !== this.previewNavigationVersion) return
    if (!dictionary || dictionary.status !== 'ready') throw new Error('词典尚未准备完成')

    await this.previewCssTask
    if (version !== this.previewNavigationVersion) return

    const window = this.runtime.windowManager.createCustomCssEditorWindow()
    const preview = this.runtime.windowManager.customCssEditorPreviewView
    if (!preview) throw new Error('CSS 编辑器预览视图尚未初始化')
    this.configurePreview(preview)
    this.activeDictionaryId = dictionaryId
    this.currentPreviewCss = ''
    this.previewCssKey = undefined
    this.previewReady = false
    preview.hide()
    await window.loadURL(editorUrl.href)

    window.show()
    window.focus()
  }

  getDictionary = async (
    event: IpcMainInvokeEvent,
    dictionaryId: unknown
  ): Promise<CustomCssEditorDictionary> => {
    this.assertEditorDictionary(event, dictionaryId)
    const dictionary = await this.db.getDictionary(dictionaryId)
    if (!dictionary || dictionary.status !== 'ready') throw new Error('词典尚未准备完成')
    return { dictionaryId, dictionaryName: dictionary.name, customCss: dictionary.customCss }
  }

  searchEntry = async (
    event: IpcMainInvokeEvent,
    dictionaryId: unknown,
    term: unknown
  ): Promise<CustomCssEditorSearchResult> => {
    this.assertEditorDictionary(event, dictionaryId)
    if (typeof term !== 'string' || !term.trim()) {
      return { ok: false, message: '请输入词条' }
    }
    const version = ++this.previewNavigationVersion
    const match = await this.db.lookupDictionaryEntry(dictionaryId, term)
    if (version !== this.previewNavigationVersion) {
      return { ok: false, message: '', cancelled: true }
    }
    if (!match) return { ok: false, message: '当前词典中未找到该词条' }

    await this.loadPreviewEntry(dictionaryId, match.word, false, undefined, version)
    if (version !== this.previewNavigationVersion) {
      return { ok: false, message: '', cancelled: true }
    }
    return {
      ok: true,
      word: match.word
    }
  }

  private async loadPreviewEntry(
    dictionaryId: string,
    entryWord: string,
    notifyRenderer: boolean,
    anchor: string | undefined,
    navigationVersion: number
  ): Promise<void> {
    const preview = this.runtime.windowManager.customCssEditorPreviewView
    if (!preview || preview.isDestroyed) throw new Error('词条预览尚未加载')

    this.setPreviewReady(false)
    preview.hide()
    await this.previewCssTask
    if (navigationVersion !== this.previewNavigationVersion) return
    this.previewCssKey = undefined
    await preview.loadURL(
      createDictionaryEntryUrl(dictionaryId, entryWord, { preview: true, anchor })
    )
    await this.previewCssTask
    if (navigationVersion !== this.previewNavigationVersion) return
    await this.previewThemeTask
    if (navigationVersion !== this.previewNavigationVersion) return
    if (notifyRenderer) this.notifyEntryWord(entryWord)
    this.setPreviewReady(true)
    preview.show()
  }

  setPreviewBounds = (event: IpcMainEvent, bounds: CustomCssEditorBounds): void => {
    if (!this.acceptsEditorSender(event.sender) || !isRectangle(bounds)) return
    this.runtime.windowManager.customCssEditorPreviewView?.setBounds(bounds)
  }

  setPreviewTheme = (event: IpcMainEvent, theme: unknown): void => {
    if (!this.acceptsEditorSender(event.sender) || !isCustomCssEditorTheme(theme)) return
    this.previewTheme = theme
    const preview = this.runtime.windowManager.customCssEditorPreviewView
    if (!preview || preview.isDestroyed || !preview.getURL()) return
    void this.applyPreviewTheme(preview, theme).catch((error: unknown) => {
      console.error('Failed to set custom CSS preview theme', { theme, error })
    })
  }

  openDevTools = (event: IpcMainEvent): void => {
    if (!this.acceptsEditorSender(event.sender)) return
    const preview = this.runtime.windowManager.customCssEditorPreviewView
    if (!preview || preview.isDestroyed || preview.webContents.isDevToolsOpened()) return

    preview.webContents.openDevTools({ mode: 'bottom' })
  }

  previewCss = (event: IpcMainEvent, css: unknown): void => {
    if (!this.acceptsEditorSender(event.sender) || typeof css !== 'string') return
    if (css.length > MAX_CUSTOM_CSS_LENGTH) return

    this.currentPreviewCss = css
    const preview = this.runtime.windowManager.customCssEditorPreviewView
    if (!preview || preview.isDestroyed || !this.previewReady) return
    void this.replacePreviewCss(preview)
  }

  save = async (event: IpcMainInvokeEvent, dictionaryId: unknown, css: unknown): Promise<void> => {
    this.assertEditorDictionary(event, dictionaryId)
    if (typeof css !== 'string') throw new Error('无效的自定义 CSS')
    if (css.length > MAX_CUSTOM_CSS_LENGTH) throw new Error('自定义 CSS 不能超过 200,000 个字符')
    this.currentPreviewCss = css
    const dictionary = await this.db.getDictionary(dictionaryId)
    if (!dictionary || dictionary.status !== 'ready') throw new Error('词典尚未准备完成')

    await this.db.updateDictionaryCustomCss(dictionaryId, css)
    if (css !== dictionary.customCss) this.refreshDictionaryView(dictionaryId)
  }

  /**
   * Reloads the dictionary view hosted by the main window when it may render the
   * given dictionary, so dictionary-specific CSS changes take effect immediately.
   */
  private refreshDictionaryView(dictionaryId: string): void {
    const numericId = Number(dictionaryId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return

    const view = this.runtime.activeDictionaryView
    if (!view || view.isDestroyed) return

    const url = view.getURL()
    if (!url) return

    // The aggregate layout renders every enabled dictionary in one page, so it is
    // reloaded regardless of which dictionary changed.
    if (
      this.runtime.dictionaryLayout == 'single' &&
      parseDictionaryEntryUrl(url)?.dictionaryId !== numericId
    ) {
      return
    }

    view.reload()
  }

  private configurePreview(
    view: NonNullable<typeof this.runtime.windowManager.customCssEditorPreviewView>
  ): void {
    if (this.configuredPreviewId === view.webContents.id) return
    this.configuredPreviewId = view.webContents.id
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url).catch((error: unknown) => {
          console.error('Failed to open dictionary preview external URL', { url, error })
        })
      }
      return { action: 'deny' }
    })
    view.webContents.on('will-navigate', (event) => {
      if (event.url.startsWith('dictol-entry://')) return
      event.preventDefault()

      const navigation = parseDictionaryEntryNavigation(event.url)
      if (navigation) void this.navigatePreviewEntry(navigation)
    })
    view.webContents.on('did-finish-load', () => {
      if (view.isDestroyed || !view.getURL()) return
      void this.applyPreviewTheme(view, this.previewTheme).catch((error: unknown) => {
        console.error('Failed to restore custom CSS preview theme after preview reload', { error })
      })
      void this.replacePreviewCss(view)
    })
    view.webContents.on('devtools-closed', () => {
      if (view.isDestroyed || !view.getURL()) return
      void this.applyPreviewTheme(view, this.previewTheme).catch((error: unknown) => {
        console.error('Failed to restore custom CSS preview theme', { error })
      })
    })
    view.webContents.on('devtools-opened', () => {
      if (view.isDestroyed || !view.getURL()) return
      void this.applyPreviewTheme(view, this.previewTheme).catch((error: unknown) => {
        console.error('Failed to restore custom CSS preview theme after opening DevTools', {
          error
        })
      })
    })
  }

  private setPreviewReady(ready: boolean): void {
    this.previewReady = ready
    const window = this.runtime.windowManager.customCssEditorWindow
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send('custom-css-editor:preview-ready', ready)
  }

  private notifyEntryWord(word: string): void {
    const window = this.runtime.windowManager.customCssEditorWindow
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send('custom-css-editor:entry-word', word)
  }

  private async navigatePreviewEntry(navigation: DictionaryLookupRequest): Promise<void> {
    const normalizedWord = navigation.word.trim()
    const dictionaryId = this.activeDictionaryId
    if (!dictionaryId || navigation.sourceDictionaryId !== dictionaryId || !normalizedWord) {
      return
    }
    const version = ++this.previewNavigationVersion

    try {
      const resolution = await resolveEntryLinkWithAnchor(navigation, (dictionaryId, term) =>
        this.db.lookupDictionaryEntry(dictionaryId, term)
      )
      if (version !== this.previewNavigationVersion) return
      if (resolution.didLookup && !resolution.match) return
      const match =
        resolution.match ?? (await this.db.lookupDictionaryEntry(dictionaryId, normalizedWord))
      if (!match) return
      if (version !== this.previewNavigationVersion) return
      await this.loadPreviewEntry(
        dictionaryId,
        match.word,
        true,
        resolution.request.anchor,
        version
      )
    } catch (error) {
      if (version !== this.previewNavigationVersion) return
      console.error('Failed to navigate custom CSS preview entry', {
        word: normalizedWord,
        error
      })
    }
  }

  /** Updates the inspected dictionary preview's color scheme via devtools if devtools is opened. */
  private async setPreviewThemeViaDevTools(theme: CustomCssEditorTheme): Promise<void> {
    const contents =
      this.runtime.windowManager.customCssEditorPreviewView?.webContents.devToolsWebContents
    if (!contents || contents.isDestroyed()) return
    await contents
      .executeJavaScript(
        `
      import('./core/common/common.js').then(({ Settings }) => {
        const settings = Settings.Settings.instance();
        settings.moduleSetting('emulated-css-media-feature-prefers-color-scheme').set(${JSON.stringify(theme)});
      })
    `
      )
      .catch((error: unknown) => {
        console.error('Failed to set custom CSS DevTools theme', { error })
      })
  }

  private async replacePreviewCss(
    preview: NonNullable<typeof this.runtime.windowManager.customCssEditorPreviewView>
  ): Promise<void> {
    const task = this.previewCssTask.then(async () => {
      if (preview.isDestroyed || !preview.getURL()) {
        this.previewCssKey = undefined
        return
      }
      if (this.previewCssKey) {
        await preview.webContents.removeInsertedCSS(this.previewCssKey).catch(() => undefined)
        this.previewCssKey = undefined
      }
      if (!this.currentPreviewCss.trim()) return
      this.previewCssKey = await preview.webContents.insertCSS(this.currentPreviewCss)
    })
    this.previewCssTask = task.catch((error: unknown) => {
      this.previewCssKey = undefined
      console.error('Failed to update custom CSS preview', { error })
    })
    return this.previewCssTask
  }

  private applyPreviewTheme(
    preview: NonNullable<typeof this.runtime.windowManager.customCssEditorPreviewView>,
    theme: CustomCssEditorTheme
  ): Promise<void> {
    preview.setBackgroundColor(theme === 'dark' ? '#232323' : '#ffffff')
    const task = this.previewThemeTask.then(async () => {
      // DevTools owns media emulation while open and reapplies its own settings.
      // Use that owner instead of competing with another debugger connection.
      if (preview.webContents.isDevToolsOpened()) {
        await this.setPreviewThemeViaDevTools(theme)
        return
      }
      const devtools = preview.webContents.debugger
      if (!devtools.isAttached()) devtools.attach('1.3')
      await devtools.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: theme }]
      })
    })
    this.previewThemeTask = task.catch(() => undefined)
    return task
  }

  private acceptsMainSender(sender: Electron.WebContents): boolean {
    return sender === this.runtime.mainWindow?.webContents
  }

  private acceptsEditorSender(sender: Electron.WebContents): boolean {
    return sender === this.runtime.windowManager.customCssEditorWindow?.webContents
  }

  private assertEditorDictionary(
    event: IpcMainInvokeEvent,
    dictionaryId: unknown
  ): asserts dictionaryId is string {
    if (
      !this.acceptsEditorSender(event.sender) ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof dictionaryId !== 'string' ||
      dictionaryId !== this.activeDictionaryId
    ) {
      throw new Error('无效的编辑器窗口')
    }
  }
}

function isRectangle(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false
  const rectangle = value as Partial<Rectangle>
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(
    (part) => typeof part === 'number' && Number.isFinite(part)
  )
}

function isCustomCssEditorTheme(value: unknown): value is CustomCssEditorTheme {
  return value === 'light' || value === 'dark'
}
