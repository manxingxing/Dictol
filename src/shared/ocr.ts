export const OCR_SUPPORTED = process.platform === 'darwin' || process.platform === 'win32'

export type OcrAiExplanation = {
  sentenceMeaning: string
  wordMeaning: string
  usage: string
}
