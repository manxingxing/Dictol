import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

import { AI_LOOKUP_MAX_SOURCE_TEXT_LENGTH } from '../../shared/ai-ipc'
import type { DictionaryNoteCreationResultEvent } from '../../shared/dictionary-note'
import { BaseController } from './base-controller'

export class ExternalExcerptController extends BaseController {
  override mount(): void {
    ipcMain.handle('external-excerpt:save', this.saveExcerpt)
    ipcMain.handle('external-excerpt:generate-note', this.generateExcerptNote)
  }

  private readonly saveExcerpt = async (
    event: IpcMainInvokeEvent,
    input: { excerpt: string; relatedTerms: string[]; comment: string }
  ): Promise<void> => {
    const window = this.getExcerptWindow(event.sender)
    if (!window) throw new Error('摘抄窗口已关闭')
    if (
      !input ||
      typeof input.excerpt !== 'string' ||
      !input.excerpt.trim() ||
      input.excerpt.length > 100_000 ||
      !Array.isArray(input.relatedTerms) ||
      !input.relatedTerms.every((term) => typeof term === 'string') ||
      typeof input.comment !== 'string'
    ) {
      throw new Error('摘抄内容无效')
    }
    await this.db.createDictionaryNote({
      relatedTerms: input.relatedTerms,
      excerpt: input.excerpt,
      comment: input.comment
    })
    const result: DictionaryNoteCreationResultEvent = {
      status: 'success',
      relatedTerms: input.relatedTerms
    }
    this.runtime.mainWindow?.webContents.send('note-creation-result', result)
    setImmediate(() => {
      if (!window.isDestroyed()) window.close()
    })
  }

  private readonly generateExcerptNote = async (
    event: IpcMainInvokeEvent,
    request: unknown
  ): Promise<string> => {
    if (!this.getExcerptWindow(event.sender)) throw new Error('摘抄窗口不可用。')
    if (!request || typeof request !== 'object') throw new Error('摘抄或关联词无效。')
    const { excerpt, relatedTerms } = request as {
      excerpt?: unknown
      relatedTerms?: unknown
    }
    if (
      typeof excerpt !== 'string' ||
      excerpt.trim().length === 0 ||
      excerpt.length > AI_LOOKUP_MAX_SOURCE_TEXT_LENGTH ||
      !Array.isArray(relatedTerms) ||
      relatedTerms.some((term) => typeof term !== 'string' || !term.trim() || term.length > 300)
    ) {
      throw new Error('摘抄或关联词无效。')
    }
    return await this.runtime.aiLookupService.generateExcerptNote(excerpt, relatedTerms)
  }

  private getExcerptWindow(sender: Electron.WebContents): BrowserWindow | undefined {
    const window = BrowserWindow.fromWebContents(sender)
    return window && this.runtime.windowManager.excerptCaptureWindows.has(window)
      ? window
      : undefined
  }
}
