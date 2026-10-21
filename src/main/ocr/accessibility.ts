import type { OcrLookupMode } from '../app-runtime'
import type { OcrCapture } from './ocr-capture-types'
import { sentenceContextAt } from './ocr-text'
import type { AccessibleTextLookup } from '../accessibility/types'

export type { AccessibleText, AccessibleTextLookup } from '../accessibility/types'

export async function captureAccessibleText(mode: OcrLookupMode): Promise<OcrCapture | null> {
  const lookup = await readFromCurrentPlatform(mode)
  const result = lookup.result
  const context = result && sentenceContextAt(result.text, result.offset)
  const matched = Boolean(
    result && context && (mode === 'dictionary' || context.context !== result.word)
  )
  if (!result || !context || !matched) return null

  return {
    selection: {
      word: result.word,
      sentence: context.sentence,
      context: context.context
    },
    wordBounds: result.bounds
  }
}

async function readFromCurrentPlatform(mode: OcrLookupMode): Promise<AccessibleTextLookup> {
  if (process.platform === 'darwin') {
    const { readAccessibleTextAtCursor } = await import('../accessibility/platforms/macos')
    return readAccessibleTextAtCursor(mode)
  }
  if (process.platform === 'win32') {
    const { readAccessibleTextAtCursor } = await import('../accessibility/platforms/windows')
    return readAccessibleTextAtCursor(mode)
  }
  return { failure: 'unsupported-platform' }
}
