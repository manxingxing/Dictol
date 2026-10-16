import type { OcrSelection } from './ocr-text'

export function isEnglishSelection(selection: OcrSelection): boolean {
  const latinLetters = selection.context.match(/\p{Script=Latin}/gu)?.length ?? 0
  const otherLetters = (selection.context.match(/\p{L}/gu)?.length ?? 0) - latinLetters
  return (
    latinLetters >= 4 &&
    otherLetters === 0 &&
    /[\p{Script=Latin}\p{N}]/u.test(selection.word)
  )
}
