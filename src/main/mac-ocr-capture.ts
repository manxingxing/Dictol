import { chineseWordRange, recognizeMacText } from '@dictol/mdict-native'
import { nativeImage, screen } from 'electron'
import type { OcrLookupMode } from './app-runtime'
import { contextTouchesCropEdge } from './ocr-crop'
import { recordMacOcrDiagnostic } from './ocr-diagnostics'
import { captureOcrDisplay, captureOcrImage, cropOcrDisplay } from './ocr-screen-capture'
import { selectOcrTextHit } from './ocr-text'
import type { OcrCapture } from './ocr-capture-types'
import { recognizeRapidText } from './rapid-ocr'

const dictionaryCaptureSize = { width: 700, height: 300 }
const aiCaptureSize = { width: 1024, height: 500 }
const expandedAiCaptureSize = { width: 1280, height: 650 }
const focusedAiCaptureSize = { width: 420, height: 240 }
// Wider margins repeatedly re-OCR fully visible lines in multi-column pages.
const aiCropEdgeMargin = { horizontal: 16, vertical: 24 }
const ocrLanguages = ['zh-Hans', 'en-US', 'ja-JP', 'zh-Hant']
const japaneseOcrLanguages = ['ja-JP', 'zh-Hans', 'en-US', 'zh-Hant']
const useVisionOcr = process.env.DICTOL_OCR_ENGINE === 'vision'

function recognizeText(png: Buffer): ReturnType<typeof recognizeRapidText> {
  return useVisionOcr ? recognizeMacText(png, ocrLanguages, true) : recognizeRapidText(png)
}

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
  let captureMs = captured.captureMs

  const ocrStartedAt = performance.now()
  let result = await recognizeText(captured.buffer)
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
  let focusedOcrMs = 0
  if (mode === 'ai' && !useVisionOcr && !hit && snapshot) {
    const focusedCaptureStartedAt = performance.now()
    const focusedCapture = cropOcrDisplay(snapshot, pointer, focusedAiCaptureSize)
    const focusedImage = nativeImage.createFromBuffer(focusedCapture.buffer)
    const enlargedImage =
      focusedCapture.size.height < 384 ? focusedImage.resize({ height: 384 }) : focusedImage
    const focused = {
      ...focusedCapture,
      buffer: enlargedImage.toPNG(),
      size: enlargedImage.getSize()
    }
    captureMs += performance.now() - focusedCaptureStartedAt
    const focusedOcrStartedAt = performance.now()
    const focusedResult = await recognizeRapidText(focused.buffer)
    focusedOcrMs = performance.now() - focusedOcrStartedAt
    const focusedSelectionStartedAt = performance.now()
    const focusedHit = selectOcrTextHit(
      focusedResult.observations,
      focused.pointer,
      focused.size.width / focused.size.height,
      chineseWordRange
    )
    selectionMs += performance.now() - focusedSelectionStartedAt
    await recordMacOcrDiagnostic(mode, 'focused', focused, pointer, focusedResult, focusedHit)
    if (focusedHit) {
      captured = focused
      result = focusedResult
      hit = focusedHit
    }
  }
  let japaneseFallbackMs = 0
  if (useVisionOcr && !hit) {
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
    (!hit ||
      (!hit.hasBothAdjacentSentences &&
        contextTouchesCropEdge(
          display.bounds,
          captured.region,
          hit.contextBounds,
          aiCropEdgeMargin
        )))
  ) {
    expanded = true
    const expandedCapture = cropOcrDisplay(snapshot, pointer, expandedAiCaptureSize)
    captureMs += expandedCapture.captureMs
    const expandedOcrStartedAt = performance.now()
    const expandedResult = await recognizeText(expandedCapture.buffer)
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
    recognitionBackend: useVisionOcr ? 'vision' : 'rapidocr',
    captureBackend: captured.backend,
    captureMs,
    ocrMs: firstPassOcrMs + focusedOcrMs + japaneseFallbackMs + expandedOcrMs,
    initialOcrMs: firstPassOcrMs,
    focusedOcrMs: focusedOcrMs || undefined,
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
