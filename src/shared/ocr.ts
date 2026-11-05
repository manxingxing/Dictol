export const OCR_SUPPORTED = process.platform === 'darwin' || process.platform === 'win32'

export type OcrAiExplanation = {
  phonetic: string
  sentenceMeaning: string
  wordMeaning: string
  usage: string
}
