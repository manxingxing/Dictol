import { readWindowsAccessibleText } from '@dictol/mdict-native'
import { screen } from 'electron'
import type { OcrLookupMode } from './app-runtime'
import type { OcrCapture } from './mac-ocr-capture'
import { sentenceContextAt } from './ocr-text'

export async function captureWindowsAccessibleText(
  mode: OcrLookupMode,
  onTextCaptured?: () => void
): Promise<OcrCapture | null> {
  const pointer = screen.getCursorScreenPoint()
  const physical = screen.dipToScreenPoint(pointer)
  const startedAt = performance.now()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const lookup = await Promise.race([
    readWindowsAccessibleText(physical.x, physical.y),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), 1_200)
    })
  ]).finally(() => clearTimeout(timeout))
  if (!lookup) {
    console.debug('[HoverText] Windows UI Automation timed out; using OCR')
    return null
  }
  const result = lookup.result
  // Older native builds can return UI Automation's image/object placeholder.
  // Treat it as unavailable text so the screenshot OCR path can run.
  if (result && (result.word.includes('\uFFFC') || !/[\p{L}\p{N}]/u.test(result.word))) {
    console.debug('[HoverText] Windows UI Automation returned an object placeholder; using OCR')
    return null
  }
  const context = result && sentenceContextAt(result.text.replaceAll('\uFFFC', ' '), result.offset)
  const matched = Boolean(
    result && context && (mode === 'dictionary' || context.context !== result.word)
  )
  console.debug('[HoverText] Windows UI Automation', {
    mode,
    captureMs: performance.now() - startedAt,
    matched,
    failure: lookup.failure
  })
  if (!result || !context || !matched) return null

  const topLeft = screen.screenToDipPoint({ x: Math.floor(result.x), y: Math.floor(result.y) })
  const bottomRight = screen.screenToDipPoint({
    x: Math.ceil(result.x + result.width),
    y: Math.ceil(result.y + result.height)
  })
  onTextCaptured?.()
  return {
    selection: { word: result.word, sentence: context.sentence, context: context.context },
    wordBounds: {
      x: topLeft.x,
      y: topLeft.y,
      width: Math.max(1, bottomRight.x - topLeft.x),
      height: Math.max(1, bottomRight.y - topLeft.y)
    }
  }
}
