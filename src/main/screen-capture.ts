import {
  captureScreenRegion,
  captureWindowsDisplayAtPoint,
  captureWindowsScreenRegion,
  getWindowsDisplayBoundsAtPoint
} from '@dictol/mdict-native'
import { desktopCapturer, screen, systemPreferences, type Display, type Rectangle } from 'electron'
import { mapWindowsCaptureRegion } from './windows-capture-geometry'

export type Screenshot = {
  data: Buffer
  mimeType: 'image/png'
  pixelSize: { width: number; height: number }
  bounds: Rectangle
  displayId: number
  backend: 'screencapturekit' | 'windows-wgc' | 'windows-gdi' | 'electron-fallback'
}

export type CaptureRequest = {
  displayId: number
  /** Global screen coordinates in Electron DIP. Omit for the entire display. */
  region?: Rectangle
}

function supportsMacNativeCapture(): boolean {
  const [major, minor] = process.getSystemVersion().split('.').map(Number)
  return major > 15 || (major === 15 && minor >= 2)
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

async function captureElectronFallback(display: Display, bounds: Rectangle): Promise<Screenshot> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor)
    }
  })
  const source = sources.find((item) => item.display_id === String(display.id))
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('无法捕获当前屏幕，请重试。')
  }
  const fullSize = source.thumbnail.getSize()
  const left = Math.round(((bounds.x - display.bounds.x) / display.bounds.width) * fullSize.width)
  const top = Math.round(((bounds.y - display.bounds.y) / display.bounds.height) * fullSize.height)
  const right = Math.round(
    ((bounds.x + bounds.width - display.bounds.x) / display.bounds.width) * fullSize.width
  )
  const bottom = Math.round(
    ((bounds.y + bounds.height - display.bounds.y) / display.bounds.height) * fullSize.height
  )
  const pixelRect = { x: left, y: top, width: right - left, height: bottom - top }
  const image = source.thumbnail.crop(pixelRect)
  return {
    data: image.toPNG(),
    mimeType: 'image/png',
    pixelSize: image.getSize(),
    bounds: {
      x: display.bounds.x + (left / fullSize.width) * display.bounds.width,
      y: display.bounds.y + (top / fullSize.height) * display.bounds.height,
      width: (pixelRect.width / fullSize.width) * display.bounds.width,
      height: (pixelRect.height / fullSize.height) * display.bounds.height
    },
    displayId: display.id,
    backend: 'electron-fallback'
  }
}

/** Capture one display or a rectangle within it. Both platforms return the same PNG contract. */
export async function captureScreen(request: CaptureRequest): Promise<Screenshot> {
  const display = screen.getAllDisplays().find((item) => item.id === request.displayId)
  if (!display) throw new Error('目标显示器不存在。')
  const bounds = request.region ?? display.bounds
  validateRegion(display, bounds)

  if (process.platform === 'darwin') {
    if (supportsMacNativeCapture()) {
      try {
        const image = await captureScreenRegion(bounds.x, bounds.y, bounds.width, bounds.height)
        return {
          data: image.png,
          mimeType: 'image/png',
          pixelSize: { width: image.width, height: image.height },
          bounds,
          displayId: display.id,
          backend: 'screencapturekit'
        }
      } catch (error) {
        console.warn('[ScreenCapture] ScreenCaptureKit failed; using Electron fallback', error)
      }
    }
    try {
      return await captureElectronFallback(display, bounds)
    } catch (error) {
      if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        throw new Error(
          '未获得屏幕录制权限。请在「系统设置 → 隐私与安全性 → 屏幕与系统音频录制」中允许启动开发版的终端或 IDE（安装版为 Dictol），然后完全退出并重新启动。'
        )
      }
      throw error
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
      if (wholeDisplay) {
        const image = await captureWindowsDisplayAtPoint(center.x, center.y)
        return {
          data: image.png,
          mimeType: 'image/png',
          pixelSize: { width: image.width, height: image.height },
          bounds: display.bounds,
          displayId: display.id,
          backend: image.backend === 'gdi' ? 'windows-gdi' : 'windows-wgc'
        }
      }
      const physicalDisplay = getWindowsDisplayBoundsAtPoint(center.x, center.y)
      const mapped = mapWindowsCaptureRegion(display.bounds, physicalDisplay, bounds)
      const image = await captureWindowsScreenRegion(
        mapped.physical.x,
        mapped.physical.y,
        mapped.physical.width,
        mapped.physical.height
      )
      return {
        data: image.png,
        mimeType: 'image/png',
        pixelSize: { width: image.width, height: image.height },
        bounds: mapped.bounds,
        displayId: display.id,
        backend: image.backend === 'gdi' ? 'windows-gdi' : 'windows-wgc'
      }
    } catch (error) {
      console.warn(
        '[ScreenCapture] Windows Graphics Capture failed; using Electron fallback',
        error
      )
      return captureElectronFallback(display, bounds)
    }
  }

  throw new Error('当前平台尚未支持屏幕截图。')
}
