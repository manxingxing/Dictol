import { captureAndRecognizeMacText, recognizeMacText, type MacOcrResult } from '@dictol/ocr-native'
import { nativeImage, type Display, type Point, type Rectangle } from 'electron'
import { cropAroundPointer, mapOcrBoundsToRegion } from './ocr-crop'
import { captureMacFallback, captureScreen, type Screenshot } from './screen-capture'

export type CaptureSize = { width: number; height: number }

export type OcrFrame = {
  size: { width: number; height: number }
  pointer: { x: number; y: number }
  region: Rectangle
  mapBounds: (bounds: Rectangle, padding?: { horizontal: number; vertical: number }) => Rectangle
}

export type CapturedImage = OcrFrame & { buffer: Buffer }

export type OcrSnapshot = { image: Screenshot }

/** Reuse one display frame for initial AI OCR and any wider context pass. */
export async function captureOcrDisplay(display: Display): Promise<OcrSnapshot> {
  const image = await captureScreen({ displayId: display.id })
  return { image }
}

/** Keep the captured region PNG for the initial crop and a wider context pass. */
export async function captureOcrRegion(
  display: Display,
  pointer: Point,
  requestedSize: CaptureSize
): Promise<OcrSnapshot> {
  const region = ocrCaptureBounds(display, pointer, requestedSize)
  const image = await captureScreen({ displayId: display.id, region })
  return { image }
}

export function cropOcrDisplay(
  snapshot: OcrSnapshot,
  pointer: Point,
  requestedSize: CaptureSize | null
): CapturedImage {
  if (!requestedSize) return toCapturedImage(snapshot.image, pointer)

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
  const startedAt = performance.now()
  const cropped = nativeImage.createFromBuffer(source.data).crop(pixels)
  console.info('[ScreenCapture] nativeImage decoded and cropped', {
    elapsedMs: Number((performance.now() - startedAt).toFixed(2))
  })
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
  return toCapturedImage(image, pointer)
}

export async function captureOcrImage(
  display: Display,
  pointer: Point,
  requestedSize: CaptureSize | null
): Promise<CapturedImage> {
  const requestedBounds = ocrCaptureBounds(display, pointer, requestedSize)
  const image = await captureScreen({ displayId: display.id, region: requestedBounds })
  return toCapturedImage(image, pointer)
}

/** Normal macOS lookup transfers coordinates and OCR results, without an image Buffer. */
export async function captureMacOcrRegion(
  display: Display,
  pointer: Point,
  requestedSize: CaptureSize,
  languages: string[]
): Promise<{ frame: OcrFrame; result: MacOcrResult }> {
  const bounds = ocrCaptureBounds(display, pointer, requestedSize)
  try {
    const result = await captureAndRecognizeMacText(
      display.id,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      languages
    )
    return {
      frame: toOcrFrame(bounds, { width: result.width, height: result.height }, pointer),
      result
    }
  } catch (error) {
    // OCR failures must propagate; only capture-stage failures permit another backend.
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_SCREEN_CAPTURE') {
      throw error
    }
    console.warn('[ScreenCapture] ScreenCaptureKit failed; using Electron fallback', error)
  }
  const image = await captureMacFallback(display, bounds)
  return {
    frame: toOcrFrame(image.bounds, image.pixelSize, pointer),
    result: await recognizeMacText(image.data, languages)
  }
}

function ocrCaptureBounds(
  display: Display,
  pointer: Point,
  requestedSize: CaptureSize | null
): Rectangle {
  const normalizedPointer = {
    x: (pointer.x - display.bounds.x) / display.bounds.width,
    y: (pointer.y - display.bounds.y) / display.bounds.height
  }
  const crop = requestedSize
    ? cropAroundPointer(display.bounds, normalizedPointer, requestedSize)
    : null
  return crop
    ? {
        x: display.bounds.x + crop.rect.x,
        y: display.bounds.y + crop.rect.y,
        width: crop.rect.width,
        height: crop.rect.height
      }
    : display.bounds
}

function toCapturedImage(image: Screenshot, pointer: Point): CapturedImage {
  return { buffer: image.data, ...toOcrFrame(image.bounds, image.pixelSize, pointer) }
}

function toOcrFrame(bounds: Rectangle, size: CaptureSize, pointer: Point): OcrFrame {
  return {
    size,
    pointer: {
      x: (pointer.x - bounds.x) / bounds.width,
      y: (pointer.y - bounds.y) / bounds.height
    },
    region: bounds,
    mapBounds: (rect, padding) => mapOcrBoundsToRegion(bounds, rect, padding)
  }
}
