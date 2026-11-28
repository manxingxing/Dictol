import type { Display, Point } from 'electron'
import { contextTouchesCropEdge } from './ocr-crop'
import { captureOcrRegion, type OcrFrame, type OcrSnapshot } from './ocr-screen-capture'
import type { OcrTextHit } from './ocr-text'
import type { CaptureEngine, OcrRecognitionMode } from '../../shared/ocr-settings'

/** Both platforms retain the same native image for both OCR passes. */
export async function captureAiOcrRegion(
  display: Display,
  pointer: Point,
  windowsCaptureEngine?: CaptureEngine,
  macRecognitionMode?: OcrRecognitionMode
): Promise<OcrSnapshot> {
  return captureOcrRegion(
    display,
    pointer,
    { width: display.bounds.width, height: 600 },
    windowsCaptureEngine,
    macRecognitionMode
  )
}

export function shouldExpandAiOcr(
  snapshot: OcrSnapshot,
  captured: OcrFrame,
  hit: OcrTextHit | null
): boolean {
  return (
    (captured.region.width < snapshot.bounds.width ||
      captured.region.height < snapshot.bounds.height) &&
    (!hit ||
      (!hit.hasBothAdjacentSentences &&
        contextTouchesCropEdge(
          snapshot.bounds,
          captured.region,
          hit.contextBounds,
          // Wider margins re-recognize fully visible lines in multi-column pages.
          { horizontal: 16, vertical: 24 }
        )))
  )
}

export function preferExpandedAiHit(hit: OcrTextHit | null, expanded: OcrTextHit | null): boolean {
  return Boolean(
    expanded &&
    (!hit ||
      (expanded.selection.word === hit.selection.word &&
        expanded.selection.context.length > hit.selection.context.length) ||
      (expanded.confidence ?? 0) > (hit.confidence ?? 0))
  )
}
