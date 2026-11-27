import { recognizeMacText, recognizeWindowsText } from '@dictol/ocr-native'
import { ocrLanguages } from './mac-ocr-languages'
import { screenshotTranslationText } from './ocr-translation'

/** Recognize PNG input using the platform's native OCR and assemble translation text. */
export async function recognizeScreenshotText(
  png: Buffer,
  windowsLanguage?: string
): Promise<string> {
  const result =
    process.platform === 'darwin'
      ? await recognizeMacText(png, ocrLanguages)
      : await recognizeWindowsText(png, windowsLanguage)
  return screenshotTranslationText(result.observations)
}
