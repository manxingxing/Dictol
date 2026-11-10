import type { Buffer } from 'node:buffer'

export interface ScreenCaptureImage {
  png: Buffer
  width: number
  height: number
}

/** Global screen coordinates and dimensions in points. */
export interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShareableDisplay {
  /** Core Graphics display ID, usable with captureDisplay and captureScreenRegion. */
  id: number
  bounds: CaptureBounds
}

export interface ShareableApplication {
  processId: number
  name: string
  bundleIdentifier: string
}

export interface ShareableWindow {
  /** Core Graphics window ID, usable with captureWindow. */
  id: number
  title?: string
  bounds: CaptureBounds
  windowLayer: number
  isOnScreen: boolean
  application?: ShareableApplication
}

/** macOS: list displays available to ScreenCaptureKit. */
export declare function listShareableDisplays(): Promise<ShareableDisplay[]>

/** macOS: list on-screen windows intersecting a display. */
export declare function listShareableWindows(): Promise<ShareableWindow[]>

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

/** macOS: capture a rectangle in global screen points contained in the given display. */
export declare function captureScreenRegion(
  displayId: number,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<ScreenCaptureImage>

/** macOS: capture the entire display identified by its Core Graphics display ID. */
export declare function captureDisplay(displayId: number): Promise<ScreenCaptureImage>

/** macOS: capture the window identified by its Core Graphics window ID. */
export declare function captureWindow(windowId: number): Promise<ScreenCaptureImage>

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
