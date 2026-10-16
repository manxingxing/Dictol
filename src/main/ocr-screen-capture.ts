import { nativeImage, type Display, type Point, type Rectangle } from 'electron'
import { cropAroundPointer, mapOcrBoundsToRegion } from './ocr-crop'
import { captureScreen, type Screenshot } from './screen-capture'

export type CaptureSize = { width: number; height: number }

export type CapturedImage = {
  buffer: Buffer
  size: { width: number; height: number }
  pointer: { x: number; y: number }
  region: Rectangle
  mapBounds: (bounds: Rectangle) => Rectangle
  backend: Screenshot['backend']
  captureMs: number
}

export type OcrDisplaySnapshot = { image: Screenshot; captureMs: number }

/** Reuse one display frame for initial AI OCR and any wider context pass. */
export async function captureOcrDisplay(display: Display): Promise<OcrDisplaySnapshot> {
  const startedAt = performance.now()
  const image = await captureScreen({ displayId: display.id })
  return { image, captureMs: performance.now() - startedAt }
}

export function cropOcrDisplay(
  snapshot: OcrDisplaySnapshot,
  pointer: Point,
  requestedSize: CaptureSize | null
): CapturedImage {
  if (!requestedSize) return toCapturedImage(snapshot.image, pointer, 0)

  const startedAt = performance.now()
  const source = snapshot.image
  const sourceBounds = source.bounds
  const crop = cropAroundPointer(
    sourceBounds,
    {
      x: (pointer.x - sourceBounds.x) / sourceBounds.width,
      y: (pointer.y - sourceBounds.y) / sourceBounds.height
    },
    requestedSize
  ).rect
  const left = Math.round((crop.x / sourceBounds.width) * source.pixelSize.width)
  const top = Math.round((crop.y / sourceBounds.height) * source.pixelSize.height)
  const right = Math.round(((crop.x + crop.width) / sourceBounds.width) * source.pixelSize.width)
  const bottom = Math.round(
    ((crop.y + crop.height) / sourceBounds.height) * source.pixelSize.height
  )
  const pixels = { x: left, y: top, width: right - left, height: bottom - top }
  const cropped = nativeImage.createFromBuffer(source.data).crop(pixels)
  const image: Screenshot = {
    ...source,
    data: cropped.toPNG(),
    pixelSize: cropped.getSize(),
    bounds: {
      x: sourceBounds.x + (left / source.pixelSize.width) * sourceBounds.width,
      y: sourceBounds.y + (top / source.pixelSize.height) * sourceBounds.height,
      width: (pixels.width / source.pixelSize.width) * sourceBounds.width,
      height: (pixels.height / source.pixelSize.height) * sourceBounds.height
    }
  }
  return toCapturedImage(image, pointer, snapshot.captureMs + performance.now() - startedAt)
}

export async function captureOcrImage(
  display: Display,
  pointer: Point,
  requestedSize: CaptureSize | null
): Promise<CapturedImage> {
  const normalizedPointer = {
    x: (pointer.x - display.bounds.x) / display.bounds.width,
    y: (pointer.y - display.bounds.y) / display.bounds.height
  }
  const crop = requestedSize
    ? cropAroundPointer(display.bounds, normalizedPointer, requestedSize)
    : null
  const requestedBounds = crop
    ? {
        x: display.bounds.x + crop.rect.x,
        y: display.bounds.y + crop.rect.y,
        width: crop.rect.width,
        height: crop.rect.height
      }
    : display.bounds
  const startedAt = performance.now()
  const image = await captureScreen({ displayId: display.id, region: requestedBounds })
  return toCapturedImage(image, pointer, performance.now() - startedAt)
}

function toCapturedImage(image: Screenshot, pointer: Point, captureMs: number): CapturedImage {
  return {
    buffer: image.data,
    size: image.pixelSize,
    pointer: {
      x: (pointer.x - image.bounds.x) / image.bounds.width,
      y: (pointer.y - image.bounds.y) / image.bounds.height
    },
    region: image.bounds,
    mapBounds: (bounds) => mapOcrBoundsToRegion(image.bounds, bounds),
    backend: image.backend,
    captureMs
  }
}
