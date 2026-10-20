import type { Rectangle } from 'electron'
import type { OcrSelection } from './ocr-text'

export type OcrCapture = { selection: OcrSelection; wordBounds: Rectangle }
