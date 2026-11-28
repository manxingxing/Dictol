import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { SELECTION_EXPLANATION_MAX_WORD_LENGTH } from '../../shared/selection-explanation'
import type { SelectionExplanationAction } from '../action/selection-explanation'
import { BaseController } from './base-controller'

export class SelectionExplanationController extends BaseController {
  override mount(): void {
    ipcMain.on('selection-explanation:show-from-main', this.showFromMain)
    ipcMain.on('selection-explanation:close', this.close)
    ipcMain.on('selection-explanation:toggle-pin', this.togglePin)
    ipcMain.on('selection-explanation:open-in-main', this.openInMain)
    ipcMain.on('selection-explanation:loading-ready', this.loadingReady)
    ipcMain.on('selection-explanation:select-dictionary', this.selectDictionary)
    ipcMain.on('selection-explanation:lookup-word', this.lookupWord)
    ipcMain.on('selection-explanation:show-ai', this.showAi)
    ipcMain.handle('selection-explanation:copy-text', this.copyText)
    ipcMain.on('selection-explanation:create-note', this.createNote)
    ipcMain.handle('selection-explanation:is-starred', this.isStarred)
    ipcMain.handle('selection-explanation:toggle-star', this.toggleStar)
    ipcMain.handle('selection-explanation:save-ai-explanation', this.saveAiExplanation)
    ipcMain.handle('selection-explanation:save-ocr-explanation', this.saveOcrExplanation)
  }

  private get explanation(): SelectionExplanationAction {
    return this.runtime.actions.explanation
  }

  private isExplanationSender(sender: WebContents): boolean {
    return this.explanation.currentWindow?.webContents.id === sender.id
  }

  private readonly showFromMain = (event: IpcMainEvent, word: unknown): void => {
    if (this.runtime.mainWindow?.webContents.id !== event.sender.id || typeof word !== 'string') {
      return
    }
    const normalizedWord = word.trim()
    if (!normalizedWord || normalizedWord.length > SELECTION_EXPLANATION_MAX_WORD_LENGTH) return
    void this.explanation.lookupAtCursor(normalizedWord)
  }

  private readonly close = (event: IpcMainEvent): void => {
    if (this.isExplanationSender(event.sender)) this.explanation.hideExplanation()
  }

  private readonly togglePin = (event: IpcMainEvent): void => {
    if (this.isExplanationSender(event.sender)) this.explanation.togglePin()
  }

  private readonly openInMain = (event: IpcMainEvent): void => {
    if (this.isExplanationSender(event.sender)) this.explanation.openInMainWindow()
  }

  private readonly loadingReady = (event: IpcMainEvent, requestId: unknown): void => {
    if (
      this.isExplanationSender(event.sender) &&
      typeof requestId === 'number' &&
      Number.isSafeInteger(requestId)
    ) {
      this.explanation.markLoadingReady(requestId)
    }
  }

  private readonly selectDictionary = (event: IpcMainEvent, dictionaryId: unknown): void => {
    if (this.isExplanationSender(event.sender) && typeof dictionaryId === 'string') {
      this.explanation.selectExplanationDictionary(dictionaryId)
    }
  }

  private readonly lookupWord = (event: IpcMainEvent, word: unknown): void => {
    if (
      typeof word === 'string' &&
      (this.isExplanationSender(event.sender) ||
        this.explanation.acceptsEntrySender(event.sender.id))
    ) {
      void this.explanation.lookupFromExplanation(word)
    }
  }

  private readonly showAi = (event: IpcMainEvent): void => {
    if (this.isExplanationSender(event.sender)) this.explanation.showAiForCurrentWord()
  }

  private readonly copyText = async (event: IpcMainInvokeEvent, text: unknown): Promise<void> => {
    if (typeof text === 'string' && text && this.explanation.acceptsEntrySender(event.sender.id)) {
      await this.explanation.copyText(text)
    }
  }

  private readonly createNote = (event: IpcMainEvent, text: unknown): void => {
    if (typeof text !== 'string' || !this.explanation.acceptsEntrySender(event.sender.id)) return
    const excerpt = text.trim()
    if (excerpt && excerpt.length <= 100_000) void this.explanation.createTextNote(excerpt)
  }

  private readonly isStarred = async (
    event: IpcMainInvokeEvent,
    word: unknown
  ): Promise<boolean> => {
    if (!this.isExplanationSender(event.sender) || typeof word !== 'string') return false
    return await this.explanation.isWordStarred(word)
  }

  private readonly toggleStar = async (event: IpcMainInvokeEvent, word: unknown): Promise<void> => {
    if (this.isExplanationSender(event.sender) && typeof word === 'string') {
      await this.explanation.toggleWordStar(word)
    }
  }

  private readonly saveAiExplanation = async (
    event: IpcMainInvokeEvent,
    commentRich: unknown
  ): Promise<void> => {
    if (!this.isExplanationSender(event.sender) || typeof commentRich !== 'string') {
      throw new Error('AI 解释尚未完成，暂时无法保存。')
    }
    await this.explanation.saveAiExplanationAsNote(commentRich)
  }

  private readonly saveOcrExplanation = async (
    event: IpcMainInvokeEvent,
    requestId: unknown
  ): Promise<void> => {
    if (!this.isExplanationSender(event.sender) || typeof requestId !== 'number') {
      throw new Error('OCR AI 解释尚未完成。')
    }
    await this.explanation.saveOcrExplanationAsExcerpt(requestId)
  }
}
