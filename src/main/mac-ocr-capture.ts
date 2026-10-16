import { chineseWordRange, recognizeMacText } from '@dictol/mdict-native'
import { screen, type Rectangle } from 'electron'
import type { OcrLookupMode } from './app-runtime'
import { contextTouchesCropEdge } from './ocr-crop'
import { recordMacOcrDiagnostic } from './ocr-diagnostics'
import { captureOcrDisplay, captureOcrImage, cropOcrDisplay } from './ocr-screen-capture'
import { selectOcrTextHit, type OcrSelection } from './ocr-text'

export type OcrCapture = { selection: OcrSelection; wordBounds: Rectangle }

const dictionaryCaptureSize = { width: 700, height: 300 }
const aiCaptureSize = { width: 1024, height: 500 }
const ocrLanguages = ['ja-JP', 'zh-Hans', 'en-US', 'zh-Hant']

export async function captureTextUnderCursor(
  mode: OcrLookupMode,
  onScreenshotCaptured?: () => void
): Promise<OcrCapture | null> {
  if (process.platform !== 'darwin') return null
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  const snapshot = mode === 'ai' ? await captureOcrDisplay(display) : null
  let captured = snapshot
    ? cropOcrDisplay(snapshot, pointer, aiCaptureSize)
    : await captureOcrImage(display, pointer, dictionaryCaptureSize)
  if (snapshot) onScreenshotCaptured?.()
  let captureMs = captured.captureMs

  const ocrStartedAt = performance.now()
  let result = await recognizeMacText(captured.buffer, ocrLanguages, mode === 'dictionary')
  const firstPassOcrMs = performance.now() - ocrStartedAt
  const firstSelectionStartedAt = performance.now()
  let hit = selectOcrTextHit(
    result.observations,
    captured.pointer,
    captured.size.width / captured.size.height,
    chineseWordRange
  )
  let selectionMs = performance.now() - firstSelectionStartedAt
  await recordMacOcrDiagnostic(mode, 'initial', captured, pointer, result, hit)
  let accurateFallbackMs = 0
  let usedAccurateFallback = false
  if (mode === 'ai' && (!hit || (hit.confidence ?? 1) < 0.4)) {
    const accurateStartedAt = performance.now()
    const accurateResult = await recognizeMacText(captured.buffer, ocrLanguages, true)
    accurateFallbackMs = performance.now() - accurateStartedAt
    const accurateSelectionStartedAt = performance.now()
    const accurateHit = selectOcrTextHit(
      accurateResult.observations,
      captured.pointer,
      captured.size.width / captured.size.height,
      chineseWordRange
    )
    selectionMs += performance.now() - accurateSelectionStartedAt
    await recordMacOcrDiagnostic(
      mode,
      'accurate-fallback',
      captured,
      pointer,
      accurateResult,
      accurateHit
    )
    if (accurateHit) {
      result = accurateResult
      hit = accurateHit
      usedAccurateFallback = true
    }
  }
  let expandedOcrMs = 0
  let expanded = false
  if (
    snapshot &&
    (captured.region.width < display.bounds.width ||
      captured.region.height < display.bounds.height) &&
    (!hit || contextTouchesCropEdge(display.bounds, captured.region, hit.contextBounds))
  ) {
    expanded = true
    const expandedCapture = cropOcrDisplay(snapshot, pointer, null)
    captureMs += expandedCapture.captureMs
    const expandedOcrStartedAt = performance.now()
    const expandedResult = await recognizeMacText(expandedCapture.buffer, ocrLanguages, false)
    expandedOcrMs = performance.now() - expandedOcrStartedAt
    const expandedSelectionStartedAt = performance.now()
    const expandedHit = selectOcrTextHit(
      expandedResult.observations,
      expandedCapture.pointer,
      expandedCapture.size.width / expandedCapture.size.height,
      chineseWordRange
    )
    selectionMs += performance.now() - expandedSelectionStartedAt
    await recordMacOcrDiagnostic(
      mode,
      'expanded',
      expandedCapture,
      pointer,
      expandedResult,
      expandedHit
    )
    const improvedContext =
      usedAccurateFallback &&
      Boolean(
        expandedHit &&
        hit &&
        expandedHit.selection.word === hit.selection.word &&
        expandedHit.selection.context.length > hit.selection.context.length
      )
    const moreConfidentHit =
      !usedAccurateFallback && (expandedHit?.confidence ?? 0) > (hit?.confidence ?? 0)
    if (expandedHit && (!hit || improvedContext || moreConfidentHit)) {
      captured = expandedCapture
      result = expandedResult
      hit = expandedHit
    }
  }
  console.debug('[OCR] capture and recognition', {
    mode,
    captureBackend: captured.backend,
    captureMs,
    ocrMs: firstPassOcrMs + accurateFallbackMs + expandedOcrMs,
    fastOcrMs: mode === 'ai' ? firstPassOcrMs : undefined,
    accurateOcrMs: mode === 'dictionary' ? firstPassOcrMs : undefined,
    accurateFallbackMs: accurateFallbackMs || undefined,
    expandedOcrMs: expandedOcrMs || undefined,
    expanded,
    selectionMs,
    imageWidth: captured.size.width,
    imageHeight: captured.size.height,
    observations: result.observations.length
  })
  if (!hit) return null
  return {
    selection: hit.selection,
    wordBounds: captured.mapBounds(hit.bounds)
  }
}
