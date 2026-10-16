import { recognizeWindowsText, type WindowsOcrResult } from '@dictol/mdict-native'
import { screen, type Display } from 'electron'
import type { OcrLookupMode } from './app-runtime'
import { contextTouchesCropEdge, mapOcrBoundsToRegion } from './ocr-crop'
import {
  captureOcrDisplay,
  captureOcrImage,
  cropOcrDisplay,
  type CapturedImage
} from './ocr-screen-capture'
import { selectOcrTextHit, type OcrTextHit } from './ocr-text'
import type { OcrCapture } from './mac-ocr-capture'

const dictionaryCaptureSize = { width: 850, height: 320 }
const aiCaptureSize = { width: 1024, height: 500 }

type Recognition = {
  result: WindowsOcrResult
  hit: OcrTextHit | null
  ocrMs: number
  selectionMs: number
  englishPass: boolean
  profileLanguage: string
}

function selectHit(result: WindowsOcrResult, captured: CapturedImage): OcrTextHit | null {
  return selectOcrTextHit(
    result.observations,
    captured.pointer,
    captured.size.width / captured.size.height
  )
}

function isLatinContext(text: string): boolean {
  return (
    (text.match(/[A-Za-z]/g)?.length ?? 0) >= 12 &&
    !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
  )
}

function isLatinWord(text: string): boolean {
  return (
    /[A-Za-z]/u.test(text) &&
    !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
  )
}

async function recognize(captured: CapturedImage, mode: OcrLookupMode): Promise<Recognition> {
  const ocrStartedAt = performance.now()
  let result = await recognizeWindowsText(captured.buffer, mode === 'ai' ? 'en-US' : undefined)
  const profileLanguage = result.recognizerLanguage
  let ocrMs = performance.now() - ocrStartedAt
  const selectionStartedAt = performance.now()
  let hit = selectHit(result, captured)
  let selectionMs = performance.now() - selectionStartedAt
  let englishPass = false

  // The profile recognizer can split English words when Windows prefers a CJK language.
  // Dictionary lookup needs this pass too, including when the first pass missed the label.
  if (
    mode === 'dictionary' &&
    !profileLanguage.toLowerCase().startsWith('en') &&
    (hit
      ? isLatinContext(hit.selection.context) || isLatinWord(hit.selection.word)
      : result.observations.some((observation) => /[A-Za-z]{2}/u.test(observation.text)))
  ) {
    try {
      const englishStartedAt = performance.now()
      const english = await recognizeWindowsText(captured.buffer, 'en-US')
      ocrMs += performance.now() - englishStartedAt
      const englishSelectionStartedAt = performance.now()
      const englishHit = selectHit(english, captured)
      selectionMs += performance.now() - englishSelectionStartedAt
      if (englishHit && isLatinWord(englishHit.selection.word)) {
        result = english
        hit = englishHit
        englishPass = true
      }
    } catch (error) {
      console.debug('[OCR] English recognizer unavailable; keeping profile result', error)
    }
  }
  return { result, hit, ocrMs, selectionMs, englishPass, profileLanguage }
}

function expandedCaptureSize(
  result: WindowsOcrResult,
  display: Display,
  snapshot: Awaited<ReturnType<typeof captureOcrDisplay>>
): { width: number; height: number } {
  const pixelScaleX = snapshot.image.pixelSize.width / display.bounds.width
  const pixelScaleY = snapshot.image.pixelSize.height / display.bounds.height
  const safePixels = result.maxImageDimension * 0.95
  return {
    width: Math.min(
      display.bounds.width,
      Math.max(aiCaptureSize.width, Math.min(aiCaptureSize.width * 1.4, safePixels / pixelScaleX))
    ),
    height: Math.min(
      display.bounds.height,
      Math.max(aiCaptureSize.height, Math.min(aiCaptureSize.height * 1.6, safePixels / pixelScaleY))
    )
  }
}

export async function captureWindowsTextUnderCursor(
  mode: OcrLookupMode,
  onScreenshotCaptured?: () => void
): Promise<OcrCapture | null> {
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  const snapshot = mode === 'ai' ? await captureOcrDisplay(display) : null
  let captured = snapshot
    ? cropOcrDisplay(snapshot, pointer, aiCaptureSize)
    : await captureOcrImage(display, pointer, dictionaryCaptureSize)
  if (snapshot) onScreenshotCaptured?.()
  let captureMs = captured.captureMs
  let recognition = await recognize(captured, mode)
  let { hit } = recognition
  let ocrMs = recognition.ocrMs
  let selectionMs = recognition.selectionMs
  let expanded = false
  let expandedMatched: boolean | undefined
  const expandedSize = snapshot ? expandedCaptureSize(recognition.result, display, snapshot) : null
  if (
    snapshot &&
    expandedSize &&
    (captured.region.width < display.bounds.width ||
      captured.region.height < display.bounds.height) &&
    (!hit || contextTouchesCropEdge(display.bounds, captured.region, hit.contextBounds)) &&
    (expandedSize.width > captured.region.width || expandedSize.height > captured.region.height)
  ) {
    expanded = true
    const expandedCapture = cropOcrDisplay(snapshot, pointer, expandedSize)
    captureMs += expandedCapture.captureMs - snapshot.captureMs
    const expandedRecognition = await recognize(expandedCapture, mode)
    ocrMs += expandedRecognition.ocrMs
    selectionMs += expandedRecognition.selectionMs
    expandedMatched = expandedRecognition.hit !== null
    if (
      expandedRecognition.hit &&
      (!hit ||
        (expandedRecognition.hit.selection.word === hit.selection.word &&
          expandedRecognition.hit.selection.context.length > hit.selection.context.length))
    ) {
      captured = expandedCapture
      recognition = expandedRecognition
      hit = expandedRecognition.hit
    }
  }
  console.debug('[OCR] capture and recognition', {
    mode,
    captureBackend: captured.backend,
    captureMs,
    ocrMs,
    selectionMs,
    expanded,
    expandedMatched,
    imageWidth: captured.size.width,
    imageHeight: captured.size.height,
    ocrProcessedWidth: recognition.result.processedWidth,
    ocrProcessedHeight: recognition.result.processedHeight,
    ocrMaxImageDimension: recognition.result.maxImageDimension,
    recognizerLanguage: recognition.result.recognizerLanguage,
    profileLanguage: recognition.profileLanguage,
    englishPass: recognition.englishPass,
    observations: recognition.result.observations.length,
    matched: hit !== null
  })
  if (!hit) return null
  return {
    selection: hit.selection,
    wordBounds: mapOcrBoundsToRegion(captured.region, hit.bounds, {
      horizontal: 1,
      vertical: 0
    })
  }
}
