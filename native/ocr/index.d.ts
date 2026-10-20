import type { Buffer } from 'node:buffer'

export interface OcrCharacterBox {
  start: number
  length: number
  x: number
  y: number
  width: number
  height: number
  quad?: Array<{ x: number; y: number }>
}

export interface OcrObservation {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence?: number
  characters: OcrCharacterBox[]
  quad?: Array<{ x: number; y: number }>
}

export interface MacOcrResult {
  observations: OcrObservation[]
}

export interface WindowsOcrResult {
  observations: OcrObservation[]
  recognizerLanguage: string
  inputWidth: number
  inputHeight: number
  processedWidth: number
  processedHeight: number
  maxImageDimension: number
}

export interface WordRange {
  start: number
  length: number
}

/** Recognize PNG text with Apple Vision. Available on macOS. */
export declare function recognizeMacText(
  png: Buffer,
  languages: string[],
  accurate: boolean
): Promise<MacOcrResult>

/** Recognize PNG text with Windows.Media.Ocr. Available on Windows. */
export declare function recognizeWindowsText(
  png: Buffer,
  language?: string
): Promise<WindowsOcrResult>

/** Find a word in UTF-16 text using NaturalLanguage. Available on macOS. */
export declare function chineseWordRange(text: string, offset: number): WordRange | null
