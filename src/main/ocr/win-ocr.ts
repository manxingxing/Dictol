import { recognizeWindowsText, type WindowsOcrResult } from '@dictol/ocr-native'
import { screen, type Display } from 'electron'
import type { OcrLookupMode } from '../app-runtime'
import { contextTouchesCropEdge, mapOcrBoundsToRegion } from './ocr-crop'
import {
  captureOcrDisplay,
  captureOcrImage,
  cropOcrDisplay,
  type CapturedImage
} from './ocr-screen-capture'
import { selectOcrTextHit, type OcrTextHit } from './ocr-text'
import type { OcrCapture } from './ocr-capture-types'

const dictionaryCaptureSize = { width: 850, height: 320 }
const aiCaptureSize = { width: 1024, height: 500 }

type Recognition = {
  result: WindowsOcrResult
  hit: OcrTextHit | null
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
  let result = await recognizeWindowsText(captured.buffer, mode === 'ai' ? 'en-US' : undefined)
  const profileLanguage = result.recognizerLanguage
  let hit = selectHit(result, captured)

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
      const english = await recognizeWindowsText(captured.buffer, 'en-US')
      const englishHit = selectHit(english, captured)
      if (englishHit && isLatinWord(englishHit.selection.word)) {
        result = english
        hit = englishHit
      }
    } catch {
      // Keep the profile result when the English OCR language pack is unavailable.
    }
  }
  return { result, hit }
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
  onCaptureReady?: () => void
): Promise<OcrCapture | null> {
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  const snapshot = mode === 'ai' ? await captureOcrDisplay(display) : null
  let captured = snapshot
    ? cropOcrDisplay(snapshot, pointer, aiCaptureSize)
    : await captureOcrImage(display, pointer, dictionaryCaptureSize)
  if (snapshot) onCaptureReady?.()
  const recognition = await recognize(captured, mode)
  let { hit } = recognition
  const expandedSize = snapshot ? expandedCaptureSize(recognition.result, display, snapshot) : null
  if (
    snapshot &&
    expandedSize &&
    (captured.region.width < display.bounds.width ||
      captured.region.height < display.bounds.height) &&
    (!hit || contextTouchesCropEdge(display.bounds, captured.region, hit.contextBounds)) &&
    (expandedSize.width > captured.region.width || expandedSize.height > captured.region.height)
  ) {
    const expandedCapture = cropOcrDisplay(snapshot, pointer, expandedSize)
    const expandedRecognition = await recognize(expandedCapture, mode)
    if (
      expandedRecognition.hit &&
      (!hit ||
        (expandedRecognition.hit.selection.word === hit.selection.word &&
          expandedRecognition.hit.selection.context.length > hit.selection.context.length))
    ) {
      captured = expandedCapture
      hit = expandedRecognition.hit
    }
  }
  if (!hit) return null
  return {
    selection: hit.selection,
    wordBounds: mapOcrBoundsToRegion(captured.region, hit.bounds, {
      horizontal: 1,
      vertical: 0
    })
  }
}
