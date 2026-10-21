import type { Point, Rectangle } from 'electron'
import type { OcrSelection } from './ocr-text'

export type OcrCapture = {
  selection: OcrSelection
  wordBounds: Rectangle
  wordQuad?: Point[]
}
