import type { OcrLookupMode } from './app-runtime'
import { captureAccessibleText } from './accessibility'
import type { OcrCapture } from './ocr-capture-types'

function prepareCapture(mode: OcrLookupMode, capture: OcrCapture | null): OcrCapture | null {
  if (!capture || mode === 'dictionary') return capture
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
  onCaptureReady?: () => void
): Promise<OcrCapture | null> {
  try {
    const accessible = await captureAccessibleText(mode)
    const prepared = prepareCapture(mode, accessible)
    if (prepared) {
      onCaptureReady?.()
      return prepared
    }
  } catch (error) {
    console.debug('[HoverText] Accessibility unavailable; using OCR', error)
  }

  if (process.platform === 'darwin') {
    const { captureTextUnderCursor: captureMacText } = await import('./mac-ocr-capture')
    const captured = await captureMacText(mode, onCaptureReady)
    return prepareCapture(mode, captured)
  }
  if (process.platform === 'win32') {
    const { captureWindowsTextUnderCursor } = await import('./win-ocr-capture')
    const captured = await captureWindowsTextUnderCursor(mode, onCaptureReady)
    return prepareCapture(mode, captured)
  }
  return null
}
