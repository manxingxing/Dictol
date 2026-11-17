import type { RapidOCRFullResult, TextBox } from 'rapidocr-node'
import type { OcrObservation } from './ocr-text'

export function toRapidOcrObservations(result: RapidOCRFullResult): OcrObservation[] {
  const width = result.img.width
  const height = result.img.height
  return result.lines.map((line) => {
    const bounds = normalizeBox(line.box, width, height)
    let nextWordStart = 0
    const characters = (line.words ?? []).flatMap((word) => {
      const start = line.text.indexOf(word.text, nextWordStart)
      if (start < 0) return []
      nextWordStart = start + word.text.length
      return [{ start, length: word.text.length, ...normalizeBox(word.box, width, height) }]
    })
    return {
      text: line.text,
      ...bounds,
      confidence: line.confidence,
      quad: line.box.map((point) => ({ x: point.x / width, y: point.y / height })),
      characters
    }
  })
}

function normalizeBox(box: TextBox, width: number, height: number): Omit<OcrObservation, 'text'> {
  const left = Math.min(...box.map((point) => point.x))
  const right = Math.max(...box.map((point) => point.x))
  const top = Math.min(...box.map((point) => point.y))
  const bottom = Math.max(...box.map((point) => point.y))
  return {
    x: left / width,
    y: 1 - bottom / height,
    width: (right - left) / width,
    height: (bottom - top) / height
  }
}
