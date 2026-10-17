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
const ocrLanguages = ['zh-Hans', 'en-US', 'ja-JP', 'zh-Hant']
const japaneseOcrLanguages = ['ja-JP', 'zh-Hans', 'en-US', 'zh-Hant']

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
  let result = await recognizeMacText(captured.buffer, ocrLanguages, true)
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
  let japaneseFallbackMs = 0
  if (!hit) {
    const fallbackStartedAt = performance.now()
    const fallbackResult = await recognizeMacText(captured.buffer, japaneseOcrLanguages, true)
    japaneseFallbackMs = performance.now() - fallbackStartedAt
    const fallbackSelectionStartedAt = performance.now()
    const fallbackHit = selectOcrTextHit(
      fallbackResult.observations,
      captured.pointer,
      captured.size.width / captured.size.height,
      chineseWordRange
    )
    selectionMs += performance.now() - fallbackSelectionStartedAt
    await recordMacOcrDiagnostic(
      mode,
      'japanese-fallback',
      captured,
      pointer,
      fallbackResult,
      fallbackHit
    )
    if (fallbackHit) {
      result = fallbackResult
      hit = fallbackHit
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
    const expandedResult = await recognizeMacText(expandedCapture.buffer, ocrLanguages, true)
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
    const improvedContext = Boolean(
      expandedHit &&
      hit &&
      expandedHit.selection.word === hit.selection.word &&
      expandedHit.selection.context.length > hit.selection.context.length
    )
    const moreConfidentHit = (expandedHit?.confidence ?? 0) > (hit?.confidence ?? 0)
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
    ocrMs: firstPassOcrMs + japaneseFallbackMs + expandedOcrMs,
    accurateOcrMs: firstPassOcrMs,
    japaneseFallbackMs: japaneseFallbackMs || undefined,
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
