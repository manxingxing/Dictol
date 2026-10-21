import { chineseWordRange, recognizeMacText } from '@dictol/ocr-native'
import { screen } from 'electron'
import type { OcrLookupMode } from '../app-runtime'
import { contextTouchesCropEdge, mapOcrQuadToRegion } from './ocr-crop'
import { captureOcrDisplay, captureOcrImage, cropOcrDisplay } from './ocr-screen-capture'
import { selectOcrTextHit } from './ocr-text'
import type { OcrCapture } from './ocr-capture-types'

const dictionaryCaptureSize = { width: 700, height: 300 }
const aiCaptureSize = { width: 1024, height: 500 }
const expandedAiCaptureSize = { width: 1280, height: 650 }
// Wider margins repeatedly re-OCR fully visible lines in multi-column pages.
const aiCropEdgeMargin = { horizontal: 16, vertical: 24 }
const ocrLanguages = ['zh-Hans', 'en-US', 'ja-JP', 'zh-Hant']
const japaneseOcrLanguages = ['ja-JP', 'zh-Hans', 'en-US', 'zh-Hant']

export async function captureTextUnderCursor(
  mode: OcrLookupMode,
  onCaptureReady?: () => void
): Promise<OcrCapture | null> {
  if (process.platform !== 'darwin') return null
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  const snapshot = mode === 'ai' ? await captureOcrDisplay(display) : null
  let captured = snapshot
    ? cropOcrDisplay(snapshot, pointer, aiCaptureSize)
    : await captureOcrImage(display, pointer, dictionaryCaptureSize)
  if (snapshot) onCaptureReady?.()
  const result = await recognizeMacText(captured.buffer, ocrLanguages, true)
  let hit = selectOcrTextHit(
    result.observations,
    captured.pointer,
    captured.size.width / captured.size.height,
    chineseWordRange
  )
  if (!hit) {
    const fallbackResult = await recognizeMacText(captured.buffer, japaneseOcrLanguages, true)
    const fallbackHit = selectOcrTextHit(
      fallbackResult.observations,
      captured.pointer,
      captured.size.width / captured.size.height,
      chineseWordRange
    )
    if (fallbackHit) {
      hit = fallbackHit
    }
  }
  if (
    snapshot &&
    (captured.region.width < display.bounds.width ||
      captured.region.height < display.bounds.height) &&
    (!hit ||
      (!hit.hasBothAdjacentSentences &&
        contextTouchesCropEdge(
          display.bounds,
          captured.region,
          hit.contextBounds,
          aiCropEdgeMargin
        )))
  ) {
    const expandedCapture = cropOcrDisplay(snapshot, pointer, expandedAiCaptureSize)
    const expandedResult = await recognizeMacText(expandedCapture.buffer, ocrLanguages, true)
    const expandedHit = selectOcrTextHit(
      expandedResult.observations,
      expandedCapture.pointer,
      expandedCapture.size.width / expandedCapture.size.height,
      chineseWordRange
    )
    const improvedContext = Boolean(
      expandedHit &&
      hit &&
      expandedHit.selection.word === hit.selection.word &&
      expandedHit.selection.context.length > hit.selection.context.length
    )
    const moreConfidentHit = (expandedHit?.confidence ?? 0) > (hit?.confidence ?? 0)
    if (expandedHit && (!hit || improvedContext || moreConfidentHit)) {
      captured = expandedCapture
      hit = expandedHit
    }
  }
  if (!hit) return null
  const highlight = hit.wordQuad && mapOcrQuadToRegion(captured.region, hit.wordQuad)
  return {
    selection: hit.selection,
    wordBounds: highlight ? highlight.bounds : captured.mapBounds(hit.bounds),
    wordQuad: highlight?.quad
  }
}
