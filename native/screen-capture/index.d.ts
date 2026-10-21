import type { Buffer } from 'node:buffer'

export interface ScreenCaptureImage {
  png: Buffer
  width: number
  height: number
}

export interface WindowsScreenCaptureImage extends ScreenCaptureImage {
  backend: 'wgc' | 'gdi'
}

export interface WindowsDisplayBounds {
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

/** Capture a region in the platform's native desktop coordinate space. */
export declare function captureScreenRegion(
  displayId: number,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<ScreenCaptureImage>

export declare function captureWindowsDisplayAtPoint(
  x: number,
  y: number
): Promise<WindowsScreenCaptureImage>

export declare function captureWindowsScreenRegion(
  x: number,
  y: number,
  width: number,
  height: number
): Promise<WindowsScreenCaptureImage>

export declare function getWindowsDisplayBoundsAtPoint(x: number, y: number): WindowsDisplayBounds

export declare function stopWindowsScreenCaptureSessions(): void
