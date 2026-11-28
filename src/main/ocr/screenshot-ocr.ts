import { recognizeMacText, recognizeWindowsText } from '@dictol/ocr-native'
import { windowsOcrLanguage, type OcrConfig } from '../../shared/ocr-settings'
import { macOcrLanguages } from './mac-ocr-languages'
import { screenshotTranslationText } from './ocr-translation'

/** Recognize PNG input using the platform's native OCR and assemble translation text. */
export async function recognizeScreenshotText(png: Buffer, config?: OcrConfig): Promise<string> {
  if (process.platform === 'darwin') {
    const mode = config && 'recognitionMode' in config ? config.recognitionMode : 'accurate'
    const result = await recognizeMacText(png, macOcrLanguages(mode), mode)
    return screenshotTranslationText(result.observations)
  }
  const language = config && 'language' in config ? windowsOcrLanguage(config) : undefined
  const result = await recognizeWindowsText(png, language)
  return screenshotTranslationText(result.observations)
}
