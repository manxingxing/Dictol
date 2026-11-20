import type { OcrLookupMode } from '../app-runtime'
import type { OcrCapture } from './ocr-capture-types'
import { sentenceContextAt } from './ocr-text'
import type { AccessibleTextLookup } from '../accessibility/types'

export type { AccessibleText, AccessibleTextLookup } from '../accessibility/types'

export const NO_WORD_AT_POINT = 'no-word-at-point'

export async function captureAccessibleText(
  mode: OcrLookupMode
): Promise<OcrCapture | typeof NO_WORD_AT_POINT | null> {
  const lookup = await readFromCurrentPlatform(mode)
  if (lookup.failure === NO_WORD_AT_POINT) return NO_WORD_AT_POINT
  const result = lookup.result
  if (!result) return null
  if (mode === 'dictionary') {
    return {
      selection: { word: result.word, sentence: '', context: '' },
      wordBounds: result.bounds
    }
  }
  if (result.text === undefined || result.offset === undefined) return null
  const context = sentenceContextAt(result.text, result.offset)
  if (!context) return null

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
