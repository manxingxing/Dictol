import type { OcrLookupMode } from './app-runtime'
import type { OcrCapture } from './mac-ocr-capture'

export async function captureTextUnderCursor(
  mode: OcrLookupMode,
  onScreenshotCaptured?: () => void
): Promise<OcrCapture | null> {
  if (process.platform === 'darwin') {
    try {
      const { captureMacAccessibleText } = await import('./mac-accessibility-capture')
      const accessible = await captureMacAccessibleText(mode, onScreenshotCaptured)
      if (accessible) return accessible
    } catch (error) {
      console.debug('[HoverText] macOS Accessibility unavailable; using OCR', error)
    }
    const { captureTextUnderCursor: captureMacText } = await import('./mac-ocr-capture')
    return captureMacText(mode, onScreenshotCaptured)
  }
  // Windows hover OCR remains in source for later work, without a runtime entry.
  return null
}
