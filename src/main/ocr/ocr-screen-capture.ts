import {
  captureAndRecognizeMacText,
  captureAndRecognizeWindowsText,
  captureMacOcrImage,
  captureWindowsOcrImage,
  getWindowsDisplayBoundsAtPoint,
  type MacOcrResult,
  type NativeOcrImage,
  type WindowsOcrResult
} from '@dictol/ocr-native'
import { screen, type Display, type Point, type Rectangle } from 'electron'
import { cropAroundPointer, mapOcrBoundsToRegion } from './ocr-crop'
import { ocrLanguages } from './mac-ocr-languages'
import { mapWindowsCaptureRegion } from './windows-capture-geometry'
import type { CaptureEngine } from '../../shared/ocr-settings'

export type CaptureSize = { width: number; height: number }

export type OcrFrame = {
  size: { width: number; height: number }
  pointer: { x: number; y: number }
  region: Rectangle
  mapBounds: (bounds: Rectangle, padding?: { horizontal: number; vertical: number }) => Rectangle
}

export type RecognizedOcrFrame = OcrFrame & { result: MacOcrResult & { textAngle?: number } }

export type OcrSnapshot = {
  image: NativeOcrImage<RecognizedOcrFrame['result'], string | undefined>
  bounds: Rectangle
}

/** Retain one native image for the initial crop and a wider context pass. */
export async function captureOcrRegion(
  display: Display,
  pointer: Point,
  requestedSize: CaptureSize,
  windowsCaptureEngine?: CaptureEngine
): Promise<OcrSnapshot> {
  const region = ocrCaptureBounds(display, pointer, requestedSize)
  if (process.platform === 'win32') {
    const center = screen.dipToScreenPoint({
      x: Math.floor(display.bounds.x + display.bounds.width / 2),
      y: Math.floor(display.bounds.y + display.bounds.height / 2)
    })
    const physicalDisplay = getWindowsDisplayBoundsAtPoint(center.x, center.y)
    const mapped = mapWindowsCaptureRegion(display.bounds, physicalDisplay, region)
    const { physical } = mapped
    const image = await captureWindowsOcrImage(
      physicalDisplay.id,
      physical.x,
      physical.y,
      physical.width,
      physical.height,
      windowsCaptureEngine
    )
    return { image, bounds: mapped.bounds }
  }
  if (process.platform === 'darwin') {
    const image = await captureMacOcrImage(
      display.id,
      region.x,
      region.y,
      region.width,
      region.height
    )
    return {
      image: {
        width: image.width,
        height: image.height,
        recognize: (rect) => image.recognize(rect, ocrLanguages),
        dispose: () => image.dispose()
      },
      bounds: region
    }
  }
  throw new Error('当前平台尚未支持屏幕截图。')
}

export async function recognizeOcrSnapshot(
  snapshot: OcrSnapshot,
  pointer: Point,
  requestedSize: CaptureSize | null,
  language?: string
): Promise<RecognizedOcrFrame> {
  const source = snapshot.image
  const sourceBounds = snapshot.bounds
  if (!requestedSize) {
    const result = await source.recognize(null, language)
    return { ...toOcrFrame(sourceBounds, source, pointer), result }
  }

  const crop = cropAroundPointer(
    sourceBounds,
    {
      x: (pointer.x - sourceBounds.x) / sourceBounds.width,
      y: (pointer.y - sourceBounds.y) / sourceBounds.height
    },
    requestedSize
  ).rect
  const left = Math.round((crop.x / sourceBounds.width) * source.width)
  const top = Math.round((crop.y / sourceBounds.height) * source.height)
  const right = Math.round(((crop.x + crop.width) / sourceBounds.width) * source.width)
  const bottom = Math.round(((crop.y + crop.height) / sourceBounds.height) * source.height)
  const pixels = { x: left, y: top, width: right - left, height: bottom - top }
  const bounds = {
    x: sourceBounds.x + (left / source.width) * sourceBounds.width,
    y: sourceBounds.y + (top / source.height) * sourceBounds.height,
    width: (pixels.width / source.width) * sourceBounds.width,
    height: (pixels.height / source.height) * sourceBounds.height
  }
  const result = await source.recognize(pixels, language)
  return { ...toOcrFrame(bounds, pixels, pointer), result }
}

/** Normal macOS lookup transfers coordinates and OCR results, without an image Buffer. */
export async function captureMacOcrRegion(
  display: Display,
  pointer: Point,
  requestedSize: CaptureSize,
  languages: string[]
): Promise<{ frame: OcrFrame; result: MacOcrResult }> {
  const bounds = ocrCaptureBounds(display, pointer, requestedSize)
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
}

/** Windows dictionary capture and OCR stay native; only metadata and text return. */
export async function captureWindowsOcrRegion(
  display: Display,
  pointer: Point,
  requestedSize: CaptureSize,
  language?: string,
  engine?: CaptureEngine
): Promise<{ result: WindowsOcrResult; frame: OcrFrame }> {
  const bounds = ocrCaptureBounds(display, pointer, requestedSize)
  const center = screen.dipToScreenPoint({
    x: Math.floor(display.bounds.x + display.bounds.width / 2),
    y: Math.floor(display.bounds.y + display.bounds.height / 2)
  })
  const physicalDisplay = getWindowsDisplayBoundsAtPoint(center.x, center.y)
  const mapped = mapWindowsCaptureRegion(display.bounds, physicalDisplay, bounds)
  const { physical } = mapped
  const result = await captureAndRecognizeWindowsText(
    physicalDisplay.id,
    physical.x,
    physical.y,
    physical.width,
    physical.height,
    language,
    engine
  )
  return {
    result,
    frame: toOcrFrame(
      mapped.bounds,
      {
        width: result.inputWidth,
        height: result.inputHeight
      },
      pointer
    )
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

function toOcrFrame(bounds: Rectangle, size: CaptureSize, pointer: Point): OcrFrame {
  return {
    size: { width: size.width, height: size.height },
    pointer: {
      x: (pointer.x - bounds.x) / bounds.width,
      y: (pointer.y - bounds.y) / bounds.height
    },
    region: bounds,
    mapBounds: (rect, padding) => mapOcrBoundsToRegion(bounds, rect, padding)
  }
}
