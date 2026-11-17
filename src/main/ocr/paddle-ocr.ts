import { chineseWordRange } from '@dictol/ocr-native'
import { screen } from 'electron'
import type { OcrLookupMode } from '../app-runtime'
import type { OcrCapture } from './ocr-capture-types'
import { captureBounds } from './native-ocr-capture'
import { captureScreen } from './screen-capture'
import { mapOcrBoundsToRegion, mapOcrQuadToRegion } from './ocr-crop'
import { selectOcrTextHit } from './ocr-text'
import { recognizeRapidText } from './rapid-ocr'

/** Paddle owns its capture, character-box hit testing, and context strategy. */
export async function capturePaddleTextUnderCursor(
  mode: OcrLookupMode,
  onCaptureReady?: () => void
): Promise<OcrCapture | null> {
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  const size =
    mode === 'ai' ? { width: display.bounds.width, height: 600 } : { width: 700, height: 300 }
  const bounds = captureBounds(display, pointer, size)
  const captureStartedAt = performance.now()
  const image = await captureScreen({ displayId: display.id, region: bounds })
  console.info('[PaddleOCR] Screenshot captured', {
    source: mode === 'ai' ? 'hover-ai' : 'hover',
    elapsedMs: Math.round(performance.now() - captureStartedAt),
    backend: image.backend,
    size: image.pixelSize
  })
  onCaptureReady?.()
  const result = await recognizeRapidText(image.data, { retryLowConfidenceLines: mode === 'ai' })
  const relativePointer = {
    x: (pointer.x - image.bounds.x) / image.bounds.width,
    y: (pointer.y - image.bounds.y) / image.bounds.height
  }
  const hit = selectOcrTextHit(
    result.observations,
    relativePointer,
    image.pixelSize.width / image.pixelSize.height,
    process.platform === 'darwin' ? chineseWordRange : undefined
  )
  if (!hit) return null
  const highlight = hit.wordQuad && mapOcrQuadToRegion(image.bounds, hit.wordQuad)
  return {
    selection: hit.selection,
    wordBounds: highlight ? highlight.bounds : mapOcrBoundsToRegion(image.bounds, hit.bounds),
    wordQuad: highlight?.quad
  }
}
