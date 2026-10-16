import { readMacAccessibleText } from '@dictol/mdict-native'
import { screen } from 'electron'
import type { OcrLookupMode } from './app-runtime'
import { mapOcrBoundsToRegion } from './ocr-crop'
import type { OcrCapture } from './mac-ocr-capture'
import { sentenceContextAt } from './ocr-text'

export async function captureMacAccessibleText(
  mode: OcrLookupMode,
  onTextCaptured?: () => void
): Promise<OcrCapture | null> {
  const pointer = screen.getCursorScreenPoint()
  const startedAt = performance.now()
  const lookup = await readMacAccessibleText(pointer.x, pointer.y, mode === 'ai')
  const result = lookup.result
  const captureMs = performance.now() - startedAt
  const context = result && sentenceContextAt(result.text, result.offset)
  const matched = Boolean(
    result && context && (mode === 'dictionary' || context.context !== result.word)
  )
  console.debug('[HoverText] macOS Accessibility', {
    mode,
    captureMs,
    matched,
    failure: lookup.failure
  })
  if (!result || !context || !matched) return null

  onTextCaptured?.()
  const display = screen.getDisplayNearestPoint(pointer)
  const region = display.bounds
  return {
    selection: {
      word: result.word,
      sentence: context.sentence,
      context: context.context
    },
    wordBounds: mapOcrBoundsToRegion(region, {
      x: (result.x - region.x) / region.width,
      y: (result.y - region.y) / region.height,
      width: result.width / region.width,
      height: result.height / region.height
    })
  }
}
