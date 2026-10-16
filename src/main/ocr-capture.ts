import type { OcrLookupMode } from './app-runtime'
import type { OcrCapture } from './mac-ocr-capture'
import { isEnglishSelection } from './ocr-language'

function prepareCapture(mode: OcrLookupMode, capture: OcrCapture | null): OcrCapture | null {
  if (!capture || mode === 'dictionary') return capture
  if (!isEnglishSelection(capture.selection)) return null
  const addSpaceAfterComma = (text: string): string =>
    text.replace(/([A-Za-z]),(?=[A-Za-z])/gu, '$1, ')
  return {
    ...capture,
    selection: {
      ...capture.selection,
      sentence: addSpaceAfterComma(capture.selection.sentence),
      context: addSpaceAfterComma(capture.selection.context)
    }
  }
}

export async function captureTextUnderCursor(
  mode: OcrLookupMode,
  onScreenshotCaptured?: () => void
): Promise<OcrCapture | null> {
  if (process.platform === 'darwin') {
    try {
      const { captureMacAccessibleText } = await import('./mac-accessibility-capture')
      const accessible = await captureMacAccessibleText(mode)
      const prepared = prepareCapture(mode, accessible)
      if (prepared) {
        onScreenshotCaptured?.()
        return prepared
      }
    } catch (error) {
      console.debug('[HoverText] macOS Accessibility unavailable; using OCR', error)
    }
    const { captureTextUnderCursor: captureMacText } = await import('./mac-ocr-capture')
    const captured = await captureMacText(mode, onScreenshotCaptured)
    return prepareCapture(mode, captured)
  }
  if (process.platform === 'win32') {
    try {
      const { captureWindowsAccessibleText } = await import('./win-accessibility-capture')
      const accessible = await captureWindowsAccessibleText(mode)
      const prepared = prepareCapture(mode, accessible)
      if (prepared) {
        onScreenshotCaptured?.()
        return prepared
      }
    } catch (error) {
      console.debug('[HoverText] Windows UI Automation unavailable; using OCR', error)
    }
    const { captureWindowsTextUnderCursor } = await import('./win-ocr-capture')
    const captured = await captureWindowsTextUnderCursor(mode, onScreenshotCaptured)
    return prepareCapture(mode, captured)
  }
  return null
}
