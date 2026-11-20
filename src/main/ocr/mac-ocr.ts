import { chineseWordRange, recognizeMacText } from '@dictol/ocr-native'
import { screen, type Display, type Point } from 'electron'
import type { OcrLookupMode } from '../app-runtime'
import { ocrLanguages } from './mac-ocr-languages'
import { contextTouchesCropEdge, mapOcrQuadToRegion } from './ocr-crop'
import { captureMacOcrRegion, captureOcrRegion, cropOcrDisplay } from './ocr-screen-capture'
import { selectOcrTextHit } from './ocr-text'
import type { OcrCapture } from './ocr-capture-types'

const dictionaryCaptureSize = { width: 1000, height: 300 }
const aiCaptureHeight = 600
const aiRecognitionHeight = 450
// Wider margins repeatedly re-OCR fully visible lines in multi-column pages.
const aiCropEdgeMargin = { horizontal: 16, vertical: 24 }

export async function captureTextUnderCursor(
  mode: OcrLookupMode,
  onCaptureReady?: () => void
): Promise<OcrCapture | null> {
  if (process.platform !== 'darwin') return null
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  if (mode === 'dictionary') return captureDictionaryText(display, pointer)
  const snapshot = await captureOcrRegion(display, pointer, {
    width: display.bounds.width,
    height: aiCaptureHeight
  })
  const recognitionSize = {
    width: Math.round((display.bounds.width * 2) / 3),
    height: aiRecognitionHeight
  }
  let captured = cropOcrDisplay(snapshot, pointer, recognitionSize)
  onCaptureReady?.()
  const result = await recognizeMacText(captured.buffer, ocrLanguages)
  let hit = selectOcrTextHit(
    result.observations,
    captured.pointer,
    captured.size.width / captured.size.height,
    chineseWordRange
  )
  if (
    (captured.region.width < snapshot.image.bounds.width ||
      captured.region.height < snapshot.image.bounds.height) &&
    (!hit ||
      (!hit.hasBothAdjacentSentences &&
        contextTouchesCropEdge(
          snapshot.image.bounds,
          captured.region,
          hit.contextBounds,
          aiCropEdgeMargin
        )))
  ) {
    // null uses the captured band directly, without another crop or PNG encoding.
    const expandedCapture = cropOcrDisplay(snapshot, pointer, null)
    const expandedResult = await recognizeMacText(expandedCapture.buffer, ocrLanguages)
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

async function captureDictionaryText(display: Display, pointer: Point): Promise<OcrCapture | null> {
  const initial = await captureMacOcrRegion(display, pointer, dictionaryCaptureSize, ocrLanguages)
  const frame = initial.frame
  const hit = selectOcrTextHit(
    initial.result.observations,
    frame.pointer,
    frame.size.width / frame.size.height,
    chineseWordRange
  )
  if (!hit) return null
  const highlight = hit.wordQuad && mapOcrQuadToRegion(frame.region, hit.wordQuad)
  return {
    selection: hit.selection,
    wordBounds: highlight ? highlight.bounds : frame.mapBounds(hit.bounds),
    wordQuad: highlight?.quad
  }
}
