import { recognizeMacText, recognizeWindowsText } from '@dictol/ocr-native'
import type { OcrEngine } from '../../shared/ocr'
import { recognizeRapidText } from './rapid-ocr'
import { repairMergedEnglishWords, screenshotTranslationText } from './ocr-translation'

/** Return text for translation while keeping engine-specific recognition and repair separate. */
export async function recognizeScreenshotText(
  engine: OcrEngine,
  png: Buffer,
  lookupRank?: (word: string) => number | null
): Promise<string> {
  if (engine === 'paddle') {
    const result = await recognizeRapidText(png, { retryLowConfidenceLines: true })
    return screenshotTranslationText(result.observations)
  }

  const result =
    process.platform === 'darwin'
      ? await recognizeMacText(png, ['en-US', 'zh-Hans', 'ja-JP', 'zh-Hant'], true)
      : await recognizeWindowsText(png)
  const text = screenshotTranslationText(result.observations)
  return lookupRank ? repairMergedEnglishWords(text, lookupRank) : text
}
