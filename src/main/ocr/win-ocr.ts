import { screen, type Display, type Point } from 'electron'
import type { OcrLookupMode } from '../app-runtime'
import { defaultHorizontalPadding, mapOcrQuadToRegion } from './ocr-crop'
import {
  captureWindowsOcrRegion,
  recognizeOcrSnapshot,
  type CaptureSize,
  type RecognizedOcrFrame
} from './ocr-screen-capture'
import { selectOcrTextHit, type OcrTextHit } from './ocr-text'
import type { OcrCapture } from './ocr-capture-types'
import { captureAiOcrRegion, shouldExpandAiOcr, preferExpandedAiHit } from './ai-ocr'
import type { WindowsCaptureEngine as CaptureEngine } from '@dictol/ocr-native'

const dictionaryCaptureSize = { width: 1000, height: 300 }
const angledRetryCaptureSize = { width: 550, height: 290 }

type WindowsFrame = RecognizedOcrFrame

async function captureDictionaryFrame(
  display: Display,
  pointer: Point,
  size: CaptureSize,
  language: string | undefined,
  engine: CaptureEngine
): Promise<WindowsFrame> {
  const { frame, result } = await captureWindowsOcrRegion(display, pointer, size, language, engine)
  return { ...frame, result }
}

function selectHit(captured: WindowsFrame): OcrTextHit | null {
  return selectOcrTextHit(
    captured.result.observations,
    captured.pointer,
    captured.size.width / captured.size.height
  )
}

export async function captureWindowsTextUnderCursor(
  mode: OcrLookupMode,
  onCaptureReady?: () => void,
  language?: string,
  engine: CaptureEngine = 'gdi'
): Promise<OcrCapture | null> {
  const startedAt = performance.now()
  let outcome: 'hit' | 'miss' | 'error' = 'error'
  try {
    const capture = await captureWindowsTextUnderCursorImpl(mode, onCaptureReady, language, engine)
    outcome = capture ? 'hit' : 'miss'
    return capture
  } finally {
    console.info('[WindowsOcr] Capture-to-result completed', {
      mode,
      outcome,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2))
    })
  }
}

async function captureWindowsTextUnderCursorImpl(
  mode: OcrLookupMode,
  onCaptureReady: (() => void) | undefined,
  language: string | undefined,
  engine: CaptureEngine
): Promise<OcrCapture | null> {
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  const initial = mode === 'ai' ? await captureAiOcrRegion(display, pointer, engine) : null
  try {
    if (initial) onCaptureReady?.()
    let captured = initial
      ? await recognizeOcrSnapshot(
          initial,
          pointer,
          {
            width: Math.round((display.bounds.width * 2) / 3),
            height: 450
          },
          language
        )
      : await captureDictionaryFrame(display, pointer, dictionaryCaptureSize, language, engine)
    let hit = selectHit(captured)
    if (!hit && mode === 'dictionary') {
      // Windows OCR chooses one dominant text angle per image. A tighter crop
      // can make the line under the pointer dominant when nearby UI text is level.
      const retryCapture = await captureDictionaryFrame(
        display,
        pointer,
        angledRetryCaptureSize,
        language,
        engine
      )
      if (
        retryCapture.region.width < captured.region.width ||
        retryCapture.region.height < captured.region.height
      ) {
        const retryHit = selectHit(retryCapture)
        if (retryHit) {
          captured = retryCapture
          hit = retryHit
        }
      }
    }
    if (initial && shouldExpandAiOcr(initial, captured, hit)) {
      const expandedCapture = await recognizeOcrSnapshot(initial, pointer, null, language)
      const expandedHit = selectHit(expandedCapture)
      if (expandedHit && preferExpandedAiHit(hit, expandedHit)) {
        captured = expandedCapture
        hit = expandedHit
      }
    }
    if (!hit) return null
    const padding = {
      horizontal: defaultHorizontalPadding(hit.bounds.width * captured.region.width),
      vertical: Math.max(1, Math.min(3, hit.bounds.height * captured.region.height * 0.1))
    }
    const highlight =
      Math.abs(captured.result.textAngle ?? 0) >= 1 && hit.wordQuad
        ? mapOcrQuadToRegion(captured.region, hit.wordQuad, padding)
        : null
    return {
      selection: hit.selection,
      wordBounds: highlight?.bounds ?? captured.mapBounds(hit.bounds, padding),
      wordQuad: highlight?.quad
    }
  } finally {
    initial?.image.dispose()
  }
}
