import {
  ScreenCaptureError,
  captureAndRecognizeMacText,
  captureAndRecognizeWindowsText,
  getPermissionStatus,
  getWindowsDisplayBoundsAtPoint,
  recognizeMacSnapshot,
  recognizeMacText,
  recognizeWindowsSnapshot,
  recognizeWindowsText,
  releaseMacSnapshot,
  releaseWindowsSnapshot,
  type MacOcrResult,
  type NativeOcrSnapshot,
  type OcrCrop,
  type WindowsOcrResult
} from '@dictol/ocr-native'
import { nativeImage, screen, type Display, type Point, type Rectangle } from 'electron'
import { cropAroundPointer, mapOcrBoundsToRegion } from './ocr-crop'
import { captureElectronFallback, type Screenshot } from './screen-capture'
import { mapWindowsCaptureRegion } from './windows-capture-geometry'

type OcrResult = MacOcrResult | WindowsOcrResult
export type CaptureSize = { width: number; height: number }
export type OcrFrame = {
  size: { width: number; height: number }
  pointer: { x: number; y: number }
  region: Rectangle
  mapBounds: (bounds: Rectangle, padding?: { horizontal: number; vertical: number }) => Rectangle
}
type Snapshot =
  | { kind: 'native'; handle: NativeOcrSnapshot; bounds: Rectangle; size: OcrFrame['size'] }
  | { kind: 'fallback'; image: Screenshot; bounds: Rectangle; size: OcrFrame['size'] }

type Options = { languages?: string[]; autoDetect?: boolean; language?: string }

type Recognition = { snapshot: Snapshot; frame: OcrFrame; result: OcrResult }

function logSnapshot(snapshot: Snapshot): void {
  console.info('[OCR] Screenshot captured', {
    backend: snapshot.kind === 'native' ? 'native' : 'electron-fallback',
    sizeDip: { width: snapshot.bounds.width, height: snapshot.bounds.height },
    sizePixels: snapshot.size
  })
}

export function releaseSnapshot(snapshot: Snapshot): void {
  if (snapshot.kind !== 'native') return
  if (process.platform === 'darwin') releaseMacSnapshot(snapshot.handle)
  else releaseWindowsSnapshot(snapshot.handle)
}

function cropFor(bounds: Rectangle, pointer: Point, size: CaptureSize | null): OcrCrop | null {
  if (!size) return null
  const { rect } = cropAroundPointer(
    bounds,
    {
      x: (pointer.x - bounds.x) / bounds.width,
      y: (pointer.y - bounds.y) / bounds.height
    },
    size
  )
  const x = rect.x / bounds.width
  const y = rect.y / bounds.height
  return {
    x,
    y,
    width: (rect.x + rect.width) / bounds.width - x,
    height: (rect.y + rect.height) / bounds.height - y
  }
}

function frameFor(snapshot: Snapshot, pointer: Point, crop: OcrCrop | null): OcrFrame {
  const { bounds, size } = snapshot
  const left = crop ? Math.round(crop.x * size.width) : 0
  const top = crop ? Math.round(crop.y * size.height) : 0
  const right = crop ? Math.round((crop.x + crop.width) * size.width) : size.width
  const bottom = crop ? Math.round((crop.y + crop.height) * size.height) : size.height
  const region = {
    x: bounds.x + (left / size.width) * bounds.width,
    y: bounds.y + (top / size.height) * bounds.height,
    width: ((right - left) / size.width) * bounds.width,
    height: ((bottom - top) / size.height) * bounds.height
  }
  return {
    size: { width: right - left, height: bottom - top },
    pointer: {
      x: (pointer.x - region.x) / region.width,
      y: (pointer.y - region.y) / region.height
    },
    region,
    mapBounds: (bounds, padding) => mapOcrBoundsToRegion(region, bounds, padding)
  }
}

async function recognizeFallback(
  snapshot: Extract<Snapshot, { kind: 'fallback' }>,
  crop: OcrCrop | null,
  options: Options
): Promise<OcrResult> {
  let png = snapshot.image.data
  if (crop) {
    const { size } = snapshot
    const left = Math.round(crop.x * size.width)
    const top = Math.round(crop.y * size.height)
    const right = Math.round((crop.x + crop.width) * size.width)
    const bottom = Math.round((crop.y + crop.height) * size.height)
    png = nativeImage
      .createFromBuffer(png)
      .crop({ x: left, y: top, width: right - left, height: bottom - top })
      .toPNG()
  }
  return process.platform === 'darwin'
    ? recognizeMacText(png, options.languages ?? [], options.autoDetect ?? false)
    : recognizeWindowsText(png, options.language)
}

export async function captureAndRecognize(
  display: Display,
  bounds: Rectangle,
  pointer: Point,
  cropSize: CaptureSize | null,
  options: Options
): Promise<Recognition> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new Error('当前平台尚未支持屏幕截图。')
  }
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x < display.bounds.x ||
    bounds.y < display.bounds.y ||
    bounds.x + bounds.width > display.bounds.x + display.bounds.width ||
    bounds.y + bounds.height > display.bounds.y + display.bounds.height
  )
    throw new Error('截图区域必须位于指定显示器内。')
  try {
    let actualBounds = bounds
    let nativeId: number | string = display.id
    let nativeBounds = bounds
    if (process.platform === 'win32') {
      const center = screen.dipToScreenPoint({
        x: Math.floor(display.bounds.x + display.bounds.width / 2),
        y: Math.floor(display.bounds.y + display.bounds.height / 2)
      })
      let physical: ReturnType<typeof getWindowsDisplayBoundsAtPoint>
      try {
        physical = getWindowsDisplayBoundsAtPoint(center.x, center.y)
      } catch (error) {
        throw new ScreenCaptureError(error instanceof Error ? error.message : String(error))
      }
      const mapped = mapWindowsCaptureRegion(display.bounds, physical, bounds)
      nativeId = physical.id
      nativeBounds = mapped.physical
      actualBounds = mapped.bounds
    }
    const crop = cropFor(actualBounds, pointer, cropSize)
    const output =
      process.platform === 'darwin'
        ? await captureAndRecognizeMacText(
            nativeId as number,
            nativeBounds.x,
            nativeBounds.y,
            nativeBounds.width,
            nativeBounds.height,
            crop,
            options.languages ?? [],
            options.autoDetect ?? false
          )
        : await captureAndRecognizeWindowsText(
            nativeId as string,
            nativeBounds.x,
            nativeBounds.y,
            nativeBounds.width,
            nativeBounds.height,
            crop,
            options.language
          )
    const snapshot: Snapshot = {
      kind: 'native',
      handle: output.snapshot,
      bounds: actualBounds,
      size: { width: output.snapshotWidth, height: output.snapshotHeight }
    }
    logSnapshot(snapshot)
    return { snapshot, frame: frameFor(snapshot, pointer, crop), result: output.result }
  } catch (error) {
    if (!(error instanceof ScreenCaptureError)) throw error
    console.warn('[ScreenCapture] Native capture failed; using Electron fallback', error)
    let image: Screenshot
    const fallbackStartedAt = performance.now()
    try {
      image = await captureElectronFallback(display, bounds)
    } catch (fallbackError) {
      if (process.platform === 'darwin' && getPermissionStatus() !== 'granted') {
        throw new Error(
          '未获得屏幕录制权限。请在「系统设置 → 隐私与安全性 → 屏幕与系统音频录制」中允许启动开发版的终端或 IDE（安装版为 Dictol），然后完全退出并重新启动。'
        )
      }
      throw fallbackError
    }
    console.info('[ScreenCapture] Electron fallback capture completed', {
      elapsedMs: Math.round(performance.now() - fallbackStartedAt)
    })
    const snapshot: Snapshot = {
      kind: 'fallback',
      image,
      bounds: image.bounds,
      size: image.pixelSize
    }
    logSnapshot(snapshot)
    const fallbackCrop = cropFor(snapshot.bounds, pointer, cropSize)
    const result = await recognizeFallback(snapshot, fallbackCrop, options)
    return { snapshot, frame: frameFor(snapshot, pointer, fallbackCrop), result }
  }
}

export async function recognizeSnapshot(
  snapshot: Snapshot,
  pointer: Point,
  cropSize: CaptureSize | null,
  options: Options
): Promise<{ frame: OcrFrame; result: OcrResult }> {
  const crop = cropFor(snapshot.bounds, pointer, cropSize)
  const frame = frameFor(snapshot, pointer, crop)
  if (snapshot.kind === 'fallback')
    return { frame, result: await recognizeFallback(snapshot, crop, options) }
  const output =
    process.platform === 'darwin'
      ? await recognizeMacSnapshot(
          snapshot.handle,
          crop,
          options.languages ?? [],
          options.autoDetect ?? false
        )
      : await recognizeWindowsSnapshot(snapshot.handle, crop, options.language)
  return { frame, result: output.result }
}

export function captureBounds(display: Display, pointer: Point, size: CaptureSize): Rectangle {
  const crop = cropAroundPointer(
    display.bounds,
    {
      x: (pointer.x - display.bounds.x) / display.bounds.width,
      y: (pointer.y - display.bounds.y) / display.bounds.height
    },
    size
  ).rect
  return {
    x: display.bounds.x + crop.x,
    y: display.bounds.y + crop.y,
    width: crop.width,
    height: crop.height
  }
}
