import { clipboard } from 'electron'
import type { AppRuntime } from '../app-runtime'
import { createCursorAnchor } from '../lib/selection-position'

/** Reads text from the system clipboard and hands it to the translation popup. */
export class ClipboardTranslationAction {
  constructor(private readonly runtime: AppRuntime) {}

  async translateFromClipboard(): Promise<void> {
    const text = (await clipboard.readText()).trim()
    if (!text) return
    this.runtime.actions.translation.showSelection(text, createCursorAnchor())
  }
}
