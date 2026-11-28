import type { OcrRecognitionMode } from '../../shared/ocr-settings'

// The six product languages; Chinese includes both simplified and traditional scripts.
const accurateOcrLanguages = ['en-US', 'zh-Hans', 'zh-Hant', 'ja-JP', 'fr-FR', 'ko-KR', 'de-DE']
const fastOcrLanguages = ['en-US', 'fr-FR', 'de-DE']

export function macOcrLanguages(mode: OcrRecognitionMode): string[] {
  return mode === 'fast' ? fastOcrLanguages : accurateOcrLanguages
}
