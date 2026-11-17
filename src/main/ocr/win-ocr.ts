import type { WindowsOcrResult } from '@dictol/ocr-native'
import { screen } from 'electron'
import type { OcrLookupMode } from '../app-runtime'
import { contextTouchesCropEdge, mapOcrQuadToRegion } from './ocr-crop'
import {
  captureAndRecognize,
  captureBounds,
  recognizeSnapshot,
  releaseSnapshot,
  type CaptureSize,
  type OcrFrame
} from './native-ocr-capture'
import { selectOcrTextHit, type OcrTextHit } from './ocr-text'
import type { OcrCapture } from './ocr-capture-types'

const dictionaryCaptureSize = { width: 850, height: 320 }
const aiCaptureSize = { width: 1024, height: 500 }
const expandedAiCaptureSize = { width: 1434, height: 800 }
const angledRetryCaptureSize = { width: 550, height: 290 }

type Recognition = {
  result: WindowsOcrResult
  hit: OcrTextHit | null
}

function selectHit(result: WindowsOcrResult, captured: OcrFrame): OcrTextHit | null {
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

async function recognize(
  captured: OcrFrame,
  mode: OcrLookupMode,
  retryEnglishOnMiss: boolean,
  initial: WindowsOcrResult,
  retryEnglish: () => Promise<WindowsOcrResult>
): Promise<Recognition> {
  let result = initial
  const profileLanguage = result.recognizerLanguage
  let hit = selectHit(result, captured)

  // The profile recognizer can split English words when Windows prefers a CJK language.
  // Dictionary lookup needs this pass too, including when the first pass missed the label.
  if (
    mode === 'dictionary' &&
    !profileLanguage.toLowerCase().startsWith('en') &&
    (hit
      ? isLatinContext(hit.selection.context) || isLatinWord(hit.selection.word)
      : retryEnglishOnMiss ||
        result.observations.some((observation) => /[A-Za-z]{2}/u.test(observation.text)))
  ) {
    try {
      const english = await retryEnglish()
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

function contextExtendsBeyondCrop(
  original: OcrFrame['region'],
  expanded: OcrFrame['region'],
  context: OcrTextHit['contextBounds']
): boolean {
  const left = expanded.x + context.x * expanded.width
  const top = expanded.y + context.y * expanded.height
  const right = left + context.width * expanded.width
  const bottom = top + context.height * expanded.height
  return (
    left < original.x - 2 ||
    top < original.y - 2 ||
    right > original.x + original.width + 2 ||
    bottom > original.y + original.height + 2
  )
}

export async function captureWindowsTextUnderCursor(
  mode: OcrLookupMode,
  onCaptureReady?: () => void
): Promise<OcrCapture | null> {
  const pointer = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pointer)
  const bounds =
    mode === 'ai' ? display.bounds : captureBounds(display, pointer, dictionaryCaptureSize)
  const size = mode === 'ai' ? aiCaptureSize : null
  const language = mode === 'ai' ? 'en-US' : undefined
  const initial = await captureAndRecognize(display, bounds, pointer, size, { language })
  try {
    let captured = initial.frame
    const snapshot = mode === 'ai' ? initial.snapshot : null
    const recognizeFrame = async (
      capture: typeof initial,
      cropSize: CaptureSize | null,
      retryEnglishOnMiss = false
    ): Promise<Recognition> =>
      recognize(
        capture.frame,
        mode,
        retryEnglishOnMiss,
        capture.result as WindowsOcrResult,
        async () =>
          (await recognizeSnapshot(capture.snapshot, pointer, cropSize, { language: 'en-US' }))
            .result as WindowsOcrResult
      )
    const recognition = await recognizeFrame(initial, size)
    let { hit } = recognition
    let selectedResult = recognition.result
    if (!hit) {
      // Windows OCR chooses one dominant text angle per image. A tighter crop
      // can make the line under the pointer dominant when nearby UI text is level.
      const retryBounds = captureBounds(display, pointer, angledRetryCaptureSize)
      if (
        retryBounds.width < captured.region.width ||
        retryBounds.height < captured.region.height
      ) {
        const retryInitial = snapshot
          ? {
              snapshot,
              ...(await recognizeSnapshot(snapshot, pointer, angledRetryCaptureSize, { language }))
            }
          : await captureAndRecognize(display, retryBounds, pointer, null, { language })
        try {
          const retryCapture = retryInitial.frame
          const retry = await recognizeFrame(
            retryInitial,
            snapshot ? angledRetryCaptureSize : null,
            true
          )
          if (retry.hit) {
            captured = retryCapture
            hit = retry.hit
            selectedResult = retry.result
          }
        } finally {
          if (!snapshot) releaseSnapshot(retryInitial.snapshot)
        }
      }
    }
    const expandedSize = snapshot
      ? {
          width: Math.min(display.bounds.width, expandedAiCaptureSize.width),
          height: Math.min(display.bounds.height, expandedAiCaptureSize.height)
        }
      : null
    if (
      snapshot &&
      expandedSize &&
      (captured.region.width < display.bounds.width ||
        captured.region.height < display.bounds.height) &&
      (!hit || contextTouchesCropEdge(display.bounds, captured.region, hit.contextBounds)) &&
      (expandedSize.width > captured.region.width || expandedSize.height > captured.region.height)
    ) {
      const expanded = {
        snapshot,
        ...(await recognizeSnapshot(snapshot, pointer, expandedSize, { language }))
      }
      const expandedCapture = expanded.frame
      const expandedRecognition = await recognizeFrame(expanded, expandedSize)
      const sameWord = expandedRecognition.hit?.selection.word === hit?.selection.word
      if (
        expandedRecognition.hit &&
        (!hit ||
          (sameWord &&
            (expandedRecognition.hit.selection.context.length > hit.selection.context.length ||
              contextExtendsBeyondCrop(
                captured.region,
                expandedCapture.region,
                expandedRecognition.hit.contextBounds
              ))))
      ) {
        captured = expandedCapture
        hit = expandedRecognition.hit
        selectedResult = expandedRecognition.result
      }
    }
    onCaptureReady?.()
    if (!hit) return null
    const padding = { horizontal: 1, vertical: 0 }
    const highlight =
      Math.abs(selectedResult.textAngle ?? 0) >= 1 && hit.wordQuad
        ? mapOcrQuadToRegion(captured.region, hit.wordQuad, padding)
        : null
    return {
      selection: hit.selection,
      wordBounds: highlight?.bounds ?? captured.mapBounds(hit.bounds, padding),
      wordQuad: highlight?.quad
    }
  } finally {
    releaseSnapshot(initial.snapshot)
  }
}
