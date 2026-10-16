import { chineseWordRange } from '@dictol/mdict-native'
import { screen, type Rectangle } from 'electron'
import type { OcrLookupMode } from './app-runtime'
import { contextTouchesCropEdge } from './ocr-crop'
import { captureOcrDisplay, captureOcrImage, cropOcrDisplay } from './ocr-screen-capture'
import { selectOcrTextHit, type OcrSelection } from './ocr-text'

export type OcrCapture = { selection: OcrSelection; wordBounds: Rectangle }

const dictionaryCaptureSize = { width: 850, height: 320 }
const aiCaptureSize = { width: 1024, height: 500 }
const ocrLanguages = 'en-US,zh-Hans,zh-Hant,ja-JP'

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

  // Load only on macOS: the native package is an optional, platform-specific dependency.
  const moduleLoadStartedAt = performance.now()
  const { default: MacOCR } = await import('@cherrystudio/mac-system-ocr')
  const moduleLoadMs = performance.now() - moduleLoadStartedAt
  const ocrStartedAt = performance.now()
  let result = await MacOCR.recognizeFromBuffer(captured.buffer, {
    languages: ocrLanguages,
    recognitionLevel:
      mode === 'dictionary' ? MacOCR.RECOGNITION_LEVEL_ACCURATE : MacOCR.RECOGNITION_LEVEL_FAST
  })
  const firstPassOcrMs = performance.now() - ocrStartedAt
  const firstSelectionStartedAt = performance.now()
  let hit = selectOcrTextHit(
    result.observations,
    captured.pointer,
    captured.size.width / captured.size.height,
    chineseWordRange
  )
  let selectionMs = performance.now() - firstSelectionStartedAt
  let expandedOcrMs = 0
  let expanded = false
  if (
    snapshot &&
    (captured.region.width < display.bounds.width ||
      captured.region.height < display.bounds.height) &&
    (!hit || contextTouchesCropEdge(display.bounds, captured.region, hit.contextBounds))
  ) {
    expanded = true
    captured = cropOcrDisplay(snapshot, pointer, null)
    captureMs += captured.captureMs
    const expandedOcrStartedAt = performance.now()
    result = await MacOCR.recognizeFromBuffer(captured.buffer, {
      languages: ocrLanguages,
      recognitionLevel: MacOCR.RECOGNITION_LEVEL_FAST
    })
    expandedOcrMs = performance.now() - expandedOcrStartedAt
    const expandedSelectionStartedAt = performance.now()
    hit = selectOcrTextHit(
      result.observations,
      captured.pointer,
      captured.size.width / captured.size.height,
      chineseWordRange
    )
    selectionMs += performance.now() - expandedSelectionStartedAt
  }
  console.debug('[OCR] capture and recognition', {
    mode,
    captureBackend: captured.backend,
    captureMs,
    moduleLoadMs,
    ocrMs: firstPassOcrMs + expandedOcrMs,
    fastOcrMs: mode === 'ai' ? firstPassOcrMs : undefined,
    accurateOcrMs: mode === 'dictionary' ? firstPassOcrMs : undefined,
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
