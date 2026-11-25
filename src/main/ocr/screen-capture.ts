import {
  captureScreenRegion,
  captureDisplay,
  getWindowsDisplayBoundsAtPoint
} from '@dictol/ocr-native'
import { screen, type Display, type Rectangle } from 'electron'
import { mapWindowsCaptureRegion } from './windows-capture-geometry'
import type { CaptureEngine } from '../../shared/ocr-settings'

export type Screenshot = {
  data: Buffer
  mimeType: 'image/png'
  pixelSize: { width: number; height: number }
  bounds: Rectangle
  displayId: number
  backend: 'screencapturekit' | 'windows-native'
}

export type CaptureRequest = {
  displayId: number
  /** Global screen coordinates in Electron DIP. Omit for the entire display. */
  region?: Rectangle
  windowsCaptureEngine?: CaptureEngine
}

function validateRegion(display: Display, region: Rectangle): void {
  const parent = display.bounds
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x < parent.x ||
    region.y < parent.y ||
    region.x + region.width > parent.x + parent.width ||
    region.y + region.height > parent.y + parent.height
  ) {
    throw new Error('截图区域必须位于指定显示器内。')
  }
}

/** Capture one display or a rectangle within it. Both platforms return the same PNG contract. */
export async function captureScreen(request: CaptureRequest): Promise<Screenshot> {
  const display = screen.getAllDisplays().find((item) => item.id === request.displayId)
  if (!display) throw new Error('目标显示器不存在。')
  const bounds = request.region ?? display.bounds
  validateRegion(display, bounds)

  if (process.platform === 'darwin') {
    const image = request.region
      ? await captureScreenRegion(display.id, bounds.x, bounds.y, bounds.width, bounds.height)
      : await captureDisplay(display.id)
    return {
      data: image.png,
      mimeType: 'image/png',
      pixelSize: { width: image.width, height: image.height },
      bounds,
      displayId: display.id,
      backend: 'screencapturekit'
    }
  }

  if (process.platform === 'win32') {
    try {
      const center = screen.dipToScreenPoint({
        x: Math.floor(display.bounds.x + display.bounds.width / 2),
        y: Math.floor(display.bounds.y + display.bounds.height / 2)
      })
      const wholeDisplay =
        bounds.x === display.bounds.x &&
        bounds.y === display.bounds.y &&
        bounds.width === display.bounds.width &&
        bounds.height === display.bounds.height
      const physicalDisplay = getWindowsDisplayBoundsAtPoint(center.x, center.y)
      if (wholeDisplay) {
        const image = await captureDisplay(physicalDisplay.id, request.windowsCaptureEngine)
        return {
          data: image.png,
          mimeType: 'image/png',
          pixelSize: { width: image.width, height: image.height },
          bounds: display.bounds,
          displayId: display.id,
          backend: 'windows-native'
        }
      }
      const mapped = mapWindowsCaptureRegion(display.bounds, physicalDisplay, bounds)
      const image = await captureScreenRegion(
        physicalDisplay.id,
        mapped.physical.x,
        mapped.physical.y,
        mapped.physical.width,
        mapped.physical.height,
        request.windowsCaptureEngine
      )
      return {
        data: image.png,
        mimeType: 'image/png',
        pixelSize: { width: image.width, height: image.height },
        bounds: mapped.bounds,
        displayId: display.id,
        backend: 'windows-native'
      }
    } catch (error) {
      // 所选方案失败时直接报告错误，不切换截图方案。
      console.warn('[ScreenCapture] Windows native capture failed', error)
      throw error
    }
  }

  throw new Error('当前平台尚未支持屏幕截图。')
}
