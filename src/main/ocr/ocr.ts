import type { OcrLookupMode } from '../app-runtime'
import { captureAccessibleText, NO_WORD_AT_POINT } from './accessibility'
import type { OcrCapture } from './ocr-capture-types'
import type { CaptureEngine } from '../../shared/ocr-settings'

export async function captureTextUnderCursor(
  mode: OcrLookupMode,
  onCaptureReady?: () => void,
  windowsLanguage?: string,
  windowsCaptureEngine?: CaptureEngine
): Promise<OcrCapture | null> {
  // 调试 OCR 时跳过辅助功能路径，普通查词和 AI 查词共用这一入口。
  if (process.env.FORCE_OCR === undefined) {
    try {
      const accessible = await captureAccessibleText(mode)
      if (accessible === NO_WORD_AT_POINT) return null
      if (accessible) {
        onCaptureReady?.()
        return accessible
      }
    } catch {
      // Fall back to OCR when the target application cannot expose accessible text.
    }
  }

  if (process.platform === 'darwin') {
    const { captureTextUnderCursor: captureMacText } = await import('./mac-ocr')
    return captureMacText(mode, onCaptureReady)
  }
  if (process.platform === 'win32') {
    const { captureWindowsTextUnderCursor } = await import('./win-ocr')
    return captureWindowsTextUnderCursor(
      mode,
      onCaptureReady,
      windowsLanguage,
      windowsCaptureEngine
    )
  }
  return null
}
