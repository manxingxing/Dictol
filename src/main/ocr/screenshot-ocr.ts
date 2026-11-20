import { recognizeMacText, recognizeWindowsText } from '@dictol/ocr-native'
import { ocrLanguages } from './mac-ocr-languages'
import { repairMergedEnglishWords, screenshotTranslationText } from './ocr-translation'
import type { OcrObservation } from './ocr-text'

/** Recognize PNG input using the platform's native OCR and assemble translation text. */
export async function recognizeScreenshotText(
  png: Buffer,
  lookupRank?: (word: string) => number | null
): Promise<string> {
  const startedAt = performance.now()
  const result =
    process.platform === 'darwin'
      ? await recognizeMacText(png, ocrLanguages)
      : await recognizeWindowsText(png)
  console.info('[ScreenshotTranslation] Native OCR returned', {
    time: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startedAt),
    observations: result.observations.length
  })
  return formatSystemScreenshotText(result.observations, lookupRank)
}

function formatSystemScreenshotText(
  observations: OcrObservation[],
  lookupRank?: (word: string) => number | null
): string {
  const assemblyStartedAt = performance.now()
  const text = screenshotTranslationText(observations)
  console.info('[ScreenshotTranslation] Text assembled', {
    time: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - assemblyStartedAt),
    length: text.length
  })
  if (!lookupRank) return text
  const repairStartedAt = performance.now()
  const repaired = repairMergedEnglishWords(text, lookupRank)
  console.info('[ScreenshotTranslation] English repair finished', {
    time: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - repairStartedAt)
  })
  return repaired
}
