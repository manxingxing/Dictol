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
  CustomCssEditorSearchResult,
  CustomCssEditorState,
  CustomCssEditorTheme
} from '../../shared/custom-css-editor'
import { createDictionaryEntryUrl } from '../dictionary-entry-url'
import { resolveRendererUrl } from '../output-path'
import { BaseController } from './base-controller'

const MAX_CUSTOM_CSS_LENGTH = 200_000

export class CustomCssEditorController extends BaseController {
  private state: CustomCssEditorState | undefined
  private previewCssKey: string | undefined
  private currentPreviewCss = ''
  private previewCssTask: Promise<void> = Promise.resolve()
  private configuredPreviewId: number | undefined
  private previewTheme: CustomCssEditorTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  private previewThemeTask: Promise<void> = Promise.resolve()
  private previewReady = false

  override mount(): void {
    ipcMain.handle('dictionaries:open-custom-css-editor', this.open)
    ipcMain.handle('custom-css-editor:get-state', this.getState)
    ipcMain.handle('custom-css-editor:get-preview-ready', this.getPreviewReady)
    ipcMain.handle('custom-css-editor:random-entry', this.randomEntry)
    ipcMain.handle('custom-css-editor:search-entry', this.searchEntry)
    ipcMain.on('custom-css-editor:set-preview-bounds', this.setPreviewBounds)
    ipcMain.on('custom-css-editor:set-preview-theme', this.setPreviewTheme)
    ipcMain.on('custom-css-editor:open-devtools', this.openDevTools)
    ipcMain.on('custom-css-editor:preview-css', this.previewCss)
    ipcMain.handle('custom-css-editor:save', this.save)
  }

  open = async (event: IpcMainInvokeEvent, dictionaryId: string): Promise<void> => {
    if (!this.acceptsMainSender(event.sender) || typeof dictionaryId !== 'string') return

    const dictionary = await this.db.getDictionary(dictionaryId)
    if (!dictionary || dictionary.status !== 'ready') throw new Error('词典尚未准备完成')
    const recordCount = dictionary.recordCount === null ? null : Number(dictionary.recordCount)

    const entry = await this.db.getRandomDictionaryEntry(dictionaryId, recordCount)
    if (!entry) throw new Error('词典中没有可预览的词条')

    this.state = {
      dictionaryId,
      dictionaryName: dictionary.name,
      customCss: dictionary.customCss,
      recordCount,
      entryId: entry.id,
      entryWord: entry.word
    }
    await this.previewCssTask
    this.currentPreviewCss = dictionary.customCss
    this.previewCssKey = undefined
    this.previewReady = false

    const window = this.runtime.windowManager.createCustomCssEditorWindow()
    const preview = this.runtime.windowManager.customCssEditorPreviewView
    if (!preview) throw new Error('CSS 编辑器预览视图尚未初始化')
    this.configurePreview(preview)
    preview.hide()

    if (!window.webContents.getURL()) {
      await window.loadURL(resolveRendererUrl('custom-css-editor.html'))
    } else {
      window.webContents.send('custom-css-editor:state', this.state)
    }

    window.show()
    window.focus()

    await preview.loadURL(createDictionaryEntryUrl(dictionaryId, entry.id, { preview: true }))
    await this.previewCssTask
    await this.applyPreviewTheme(preview, this.previewTheme).catch((error: unknown) => {
      console.error('Failed to initialize custom CSS preview theme', { error })
    })
    this.setPreviewReady(true)
    preview.show()
  }

  getState = (event: IpcMainInvokeEvent): CustomCssEditorState | null => {
    if (!this.acceptsEditorSender(event.sender)) return null
    return this.state ?? null
  }

  getPreviewReady = (event: IpcMainInvokeEvent): boolean => {
    if (!this.acceptsEditorSender(event.sender)) return false
    return this.previewReady
  }

  randomEntry = async (event: IpcMainInvokeEvent): Promise<CustomCssEditorState> => {
    if (!this.acceptsEditorSender(event.sender)) throw new Error('无效的编辑器窗口')
    const state = this.state
    if (!state) throw new Error('CSS 编辑器尚未初始化')

    const entry = await this.db.getRandomDictionaryEntry(state.dictionaryId, state.recordCount)
    if (!entry) throw new Error('词典中没有可预览的词条')

    return this.loadPreviewEntry(state, entry.id, entry.word)
  }

  searchEntry = async (
    event: IpcMainInvokeEvent,
    term: unknown
  ): Promise<CustomCssEditorSearchResult> => {
    if (!this.acceptsEditorSender(event.sender)) throw new Error('无效的编辑器窗口')
    const state = this.state
    if (!state) throw new Error('CSS 编辑器尚未初始化')
    if (typeof term !== 'string' || !term.trim()) {
      return { ok: false, message: '请输入词条' }
    }
    const group = await this.db.lookupDictionaryEntryGroup(term)
    const match = group?.dictionaries.find((item) => item.dictionaryId === state.dictionaryId)
    if (!match) return { ok: false, message: '当前词典中未找到该词条' }
    const entry = await this.db.getDictionaryEntryRecord(match.entryId)
    if (!entry) return { ok: false, message: '词条不存在' }
    return { ok: true, state: await this.loadPreviewEntry(state, entry.id, entry.word) }
  }

  private async loadPreviewEntry(
    state: CustomCssEditorState,
    entryId: string,
    entryWord: string,
    notifyRenderer = false
  ): Promise<CustomCssEditorState> {
    const preview = this.runtime.windowManager.customCssEditorPreviewView
    if (!preview || preview.isDestroyed) throw new Error('词条预览尚未加载')

    this.setPreviewReady(false)
    preview.hide()
    await this.previewCssTask
    this.previewCssKey = undefined
    await preview.loadURL(createDictionaryEntryUrl(state.dictionaryId, entryId, { preview: true }))
    await this.previewCssTask
    await this.applyPreviewTheme(preview, this.previewTheme).catch((error: unknown) => {
      console.error('Failed to initialize custom CSS preview theme', { error })
    })
    const nextState = { ...state, entryId, entryWord }
    this.state = nextState
    if (notifyRenderer) this.notifyState(nextState)
    this.setPreviewReady(true)
    preview.show()
    return nextState
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

    const preview = this.runtime.windowManager.customCssEditorPreviewView
    if (!preview || preview.isDestroyed) return
    this.currentPreviewCss = css
    void this.replacePreviewCss(preview, css)
  }

  save = async (event: IpcMainInvokeEvent, css: unknown): Promise<void> => {
    if (!this.acceptsEditorSender(event.sender) || typeof css !== 'string') return
    if (css.length > MAX_CUSTOM_CSS_LENGTH) throw new Error('自定义 CSS 不能超过 200,000 个字符')
    const state = this.state
    if (!state) throw new Error('CSS 编辑器尚未初始化')

    await this.db.updateDictionaryCustomCss(state.dictionaryId, css)
    this.currentPreviewCss = css
    this.state = { ...state, customCss: css }
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
      if (event.url.startsWith('entry://')) {
        void this.navigatePreviewEntry(decodeEntryTarget(event.url))
      }
    })
    view.webContents.on('did-finish-load', () => {
      if (view.isDestroyed || !view.getURL()) return
      void this.applyPreviewTheme(view, this.previewTheme).catch((error: unknown) => {
        console.error('Failed to restore custom CSS preview theme after preview reload', { error })
      })
      void this.replacePreviewCss(view, this.currentPreviewCss)
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
        console.error('Failed to preserve custom CSS preview theme after opening DevTools', {
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

  private notifyState(state: CustomCssEditorState): void {
    const window = this.runtime.windowManager.customCssEditorWindow
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send('custom-css-editor:state', state)
  }

  private async navigatePreviewEntry(word: string): Promise<void> {
    const normalizedWord = word.trim()
    const state = this.state
    if (!state || !normalizedWord || normalizedWord.length > 200) return

    try {
      const group = await this.db.lookupDictionaryEntryGroup(normalizedWord)
      const match = group?.dictionaries.find((item) => item.dictionaryId === state.dictionaryId)
      if (!match) return
      const entry = await this.db.getDictionaryEntryRecord(match.entryId)
      if (!entry) return
      await this.loadPreviewEntry(state, entry.id, entry.word, true)
    } catch (error) {
      console.error('Failed to navigate custom CSS preview entry', {
        word: normalizedWord,
        error
      })
    }
  }

  private async applyDevToolsTheme(theme: CustomCssEditorTheme): Promise<void> {
    const contents =
      this.runtime.windowManager.customCssEditorPreviewView?.webContents.devToolsWebContents
    if (!contents || contents.isDestroyed()) return
    // DevTools uses "default" for its light UI theme. This is a Chromium frontend
    // setting; Electron does not expose a per-DevTools theme API.
    const uiTheme = theme === 'dark' ? 'dark' : 'default'
    await contents
      .executeJavaScript(
        `
      import('./core/common/common.js').then(({ Settings }) => {
        const settings = Settings.Settings.instance();
        settings.moduleSetting('ui-theme').set(${JSON.stringify(uiTheme)});
        settings.moduleSetting('emulated-css-media-feature-prefers-color-scheme').set(${JSON.stringify(theme)});
      })
    `
      )
      .catch((error: unknown) => {
        console.error('Failed to set custom CSS DevTools UI theme', { error })
      })
  }

  private async replacePreviewCss(
    preview: NonNullable<typeof this.runtime.windowManager.customCssEditorPreviewView>,
    css: string
  ): Promise<void> {
    this.currentPreviewCss = css
    const task = this.previewCssTask.then(async () => {
      if (this.previewCssKey) {
        await preview.webContents.removeInsertedCSS(this.previewCssKey).catch(() => undefined)
        this.previewCssKey = undefined
      }
      if (!this.currentPreviewCss.trim() || preview.isDestroyed) return
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
    preview.setBackgroundColor(theme === 'dark' ? '#212121' : '#ffffff')
    const task = this.previewThemeTask.then(async () => {
      // DevTools owns media emulation while open and reapplies its own settings.
      // Use that owner instead of competing with another debugger connection.
      if (preview.webContents.isDevToolsOpened()) {
        await this.applyDevToolsTheme(theme)
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
}

function decodeEntryTarget(url: string): string {
  const target = url.replace(/^entry:\/\/\/?/i, '').split('#', 1)[0]
  try {
    return decodeURIComponent(target)
  } catch {
    return target
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
