import type { OcrLookupMode } from './app-runtime'
import type { OcrCapture } from './mac-ocr-capture'

export async function captureTextUnderCursor(
  mode: OcrLookupMode,
  onScreenshotCaptured?: () => void
): Promise<OcrCapture | null> {
  if (process.platform === 'darwin') {
    const { captureTextUnderCursor: captureMacText } = await import('./mac-ocr-capture')
    return captureMacText(mode, onScreenshotCaptured)
  }
  if (process.platform === 'win32') {
    const { captureWindowsTextUnderCursor } = await import('./win-ocr-capture')
    return captureWindowsTextUnderCursor(mode, onScreenshotCaptured)
  }
  return null
}
