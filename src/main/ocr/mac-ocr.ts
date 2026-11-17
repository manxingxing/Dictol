import { chineseWordRange, type MacOcrResult } from '@dictol/ocr-native'
import { screen } from 'electron'
import type { OcrLookupMode } from '../app-runtime'
import { contextTouchesCropEdge, mapOcrQuadToRegion } from './ocr-crop'
import {
  captureAndRecognize,
  captureBounds,
  recognizeSnapshot,
  releaseSnapshot
} from './native-ocr-capture'
import { selectOcrTextHit } from './ocr-text'
import type { OcrCapture } from './ocr-capture-types'

const dictionaryCaptureSize = { width: 700, height: 300 }
const aiCaptureHeight = 600
const aiRecognitionHeight = 450
// Wider margins repeatedly re-OCR fully visible lines in multi-column pages.
const aiCropEdgeMargin = { horizontal: 16, vertical: 24 }
const ocrLanguages = ['en-US', 'zh-Hans', 'zh-Hant', 'ja-JP']

export async function captureTextUnderCursor(
  mode: OcrLookupMode,
  onCaptureReady?: () => void
): Promise<OcrCapture | null> {
  if (process.platform !== 'darwin') return null
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  const aiCaptureSize = { width: display.bounds.width, height: aiCaptureHeight }
  const aiRecognitionSize = {
    width: Math.round((display.bounds.width * 2) / 3),
    height: aiRecognitionHeight
  }
  const bounds = captureBounds(
    display,
    pointer,
    mode === 'ai' ? aiCaptureSize : dictionaryCaptureSize
  )
  const options = { languages: ocrLanguages, autoDetect: true }
  const initial = await captureAndRecognize(
    display,
    bounds,
    pointer,
    mode === 'ai' ? aiRecognitionSize : null,
    options
  )
  try {
    let captured = initial.frame
    const snapshot = mode === 'ai' ? initial.snapshot : null
    const result = initial.result as MacOcrResult
    let hit = selectOcrTextHit(
      result.observations,
      captured.pointer,
      captured.size.width / captured.size.height,
      chineseWordRange
    )
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
      const expanded = await recognizeSnapshot(snapshot, pointer, null, options)
      const expandedCapture = expanded.frame
      const expandedResult = expanded.result as MacOcrResult
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
    onCaptureReady?.()
    if (!hit) return null
    const highlight = hit.wordQuad && mapOcrQuadToRegion(captured.region, hit.wordQuad)
    return {
      selection: hit.selection,
      wordBounds: highlight ? highlight.bounds : captured.mapBounds(hit.bounds),
      wordQuad: highlight?.quad
    }
  } finally {
    releaseSnapshot(initial.snapshot)
  }
}
