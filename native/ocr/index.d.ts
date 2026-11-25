import type { Buffer } from 'node:buffer'

export interface ScreenCaptureImage {
  png: Buffer
  width: number
  height: number
}

export type WindowsCaptureEngine = 'gdi' | 'wgc'

/** Global screen coordinates: points on macOS, physical pixels on Windows. */
export interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShareableDisplay {
  /** Core Graphics ID on macOS; hexadecimal HMONITOR string on Windows. */
  id: number | string
  bounds: CaptureBounds
  name?: string
}

export interface ShareableApplication {
  processId: number
  name?: string
  bundleIdentifier?: string
}

export interface ShareableWindow {
  /** Core Graphics ID on macOS; hexadecimal HWND string on Windows. */
  id: number | string
  title?: string
  bounds: CaptureBounds
  windowLayer?: number
  isOnScreen?: boolean
  application?: ShareableApplication
}

/** List displays available for capture. */
export declare function listShareableDisplays(): Promise<ShareableDisplay[]>

/** List windows available for capture, using platform-specific visibility rules. */
export declare function listShareableWindows(): Promise<ShareableWindow[]>

export interface WindowsDisplayBounds {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export type ScreenCapturePermissionStatus = 'granted' | 'not-granted' | 'not-required'

/** An advisory status for the current process; capture itself remains the final check. */
export declare function getPermissionStatus(): ScreenCapturePermissionStatus

/** Open the macOS Screen Recording settings page. Rejects on other platforms. */
export declare function openPermissionSettings(): Promise<void>

/** Capture a rectangle contained in the display, using platform-native global coordinates. */
export declare function captureScreenRegion(
  displayId: number | string,
  x: number,
  y: number,
  width: number,
  height: number,
  /** Windows only. Defaults to GDI. No fallback between engines. */
  engine?: WindowsCaptureEngine
): Promise<ScreenCaptureImage>

/** Capture the entire display. */
export declare function captureDisplay(
  displayId: number | string,
  engine?: WindowsCaptureEngine
): Promise<ScreenCaptureImage>

/** Capture an individual window. */
export declare function captureWindow(
  windowId: number | string,
  engine?: WindowsCaptureEngine
): Promise<ScreenCaptureImage>

export declare function getWindowsDisplayBoundsAtPoint(x: number, y: number): WindowsDisplayBounds

export interface OcrCharacterBox {
  start: number
  length: number
  x: number
  y: number
  width: number
  height: number
  quad?: Array<{ x: number; y: number }>
}

export interface OcrObservation {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence?: number
  characters: OcrCharacterBox[]
  quad?: Array<{ x: number; y: number }>
}

export interface MacOcrResult {
  observations: OcrObservation[]
}

export interface WindowsOcrResult {
  observations: OcrObservation[]
  recognizerLanguage: string
  inputWidth: number
  inputHeight: number
  processedWidth: number
  processedHeight: number
  maxImageDimension: number
  /** Clockwise text rotation in degrees, when detected by Windows OCR. */
  textAngle?: number
}

/** An owned native screenshot. Regions use integer pixels relative to this image. */
export interface NativeOcrImage<Result, Language> {
  readonly width: number
  readonly height: number
  /** null recognizes the entire retained image. Each task retains its own reference. */
  recognize(region: CaptureBounds | null, language: Language): Promise<Result>
  /** Idempotent. Releases the handle's image; queued tasks finish independently. GC is a fallback. */
  dispose(): void
}

export declare function captureWindowsOcrImage(
  displayId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  engine?: WindowsCaptureEngine
): Promise<NativeOcrImage<WindowsOcrResult, string | undefined>>

export interface WordRange {
  start: number
  length: number
}

/** Recognize PNG text with Apple Vision and automatic language detection. Available on macOS. */
export declare function recognizeMacText(png: Buffer, languages: string[]): Promise<MacOcrResult>

export interface MacRegionOcrResult extends MacOcrResult {
  /** Captured image dimensions in pixels. */
  width: number
  height: number
}

/** Capture global screen points within one display and recognize directly with Vision.
 * No PNG or image handle is returned. Capture failures have code ERR_SCREEN_CAPTURE.
 * Available on macOS 13+; invalid input and OCR errors reject without that code.
 */
export declare function captureAndRecognizeMacText(
  displayId: number,
  x: number,
  y: number,
  width: number,
  height: number,
  languages: string[]
): Promise<MacRegionOcrResult>

/** Recognize PNG text with Windows.Media.Ocr. Available on Windows. */
export declare function recognizeWindowsText(
  png: Buffer,
  language?: string
): Promise<WindowsOcrResult>

/** Capture a physical-pixel region and recognize it in one native task. Windows only. */
export declare function captureAndRecognizeWindowsText(
  displayId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  language?: string,
  engine?: WindowsCaptureEngine
): Promise<WindowsOcrResult>

/** Find a word in UTF-16 text using NaturalLanguage. Available on macOS. */
export declare function chineseWordRange(text: string, offset: number): WordRange | null
