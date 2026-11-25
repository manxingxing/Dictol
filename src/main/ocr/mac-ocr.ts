import { chineseWordRange } from '@dictol/ocr-native'
import { screen, type Display, type Point } from 'electron'
import type { OcrLookupMode } from '../app-runtime'
import { ocrLanguages } from './mac-ocr-languages'
import { mapOcrQuadToRegion } from './ocr-crop'
import { captureMacOcrRegion, recognizeOcrSnapshot } from './ocr-screen-capture'
import { captureAiOcrRegion, shouldExpandAiOcr, preferExpandedAiHit } from './ai-ocr'
import { selectOcrTextHit } from './ocr-text'
import type { OcrCapture } from './ocr-capture-types'

const dictionaryCaptureSize = { width: 1000, height: 300 }

export async function captureTextUnderCursor(
  mode: OcrLookupMode,
  onCaptureReady?: () => void
): Promise<OcrCapture | null> {
  if (process.platform !== 'darwin') return null
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  if (mode === 'dictionary') return captureDictionaryText(display, pointer)
  const snapshot = await captureAiOcrRegion(display, pointer)
  try {
    onCaptureReady?.()
    let captured = await recognizeOcrSnapshot(snapshot, pointer, {
      width: Math.round((display.bounds.width * 2) / 3),
      height: 450
    })
    let hit = selectOcrTextHit(
      captured.result.observations,
      captured.pointer,
      captured.size.width / captured.size.height,
      chineseWordRange
    )
    if (shouldExpandAiOcr(snapshot, captured, hit)) {
      const expandedCapture = await recognizeOcrSnapshot(snapshot, pointer, null)
      const expandedHit = selectOcrTextHit(
        expandedCapture.result.observations,
        expandedCapture.pointer,
        expandedCapture.size.width / expandedCapture.size.height,
        chineseWordRange
      )
      if (expandedHit && preferExpandedAiHit(hit, expandedHit)) {
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
  } finally {
    snapshot.image.dispose()
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
