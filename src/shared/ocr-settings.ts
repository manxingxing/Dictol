export const OCR_ENGINE_OPTIONS = [{ value: 'system', label: '系统内置' }] as const

export const CAPTURE_ENGINE_OPTIONS = [
  { value: 'gdi', label: 'GDI' },
  { value: 'wgc', label: 'WGC' }
] as const

export type CaptureEngine = (typeof CAPTURE_ENGINE_OPTIONS)[number]['value']

export const OCR_LANGUAGE_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'en-US', label: '英语' },
  { value: 'ja-JP', label: '日语' },
  { value: 'ko-KR', label: '韩语' },
  { value: 'fr-FR', label: '法语' },
  { value: 'de-DE', label: '德语' }
] as const

export type OcrLanguage = (typeof OCR_LANGUAGE_OPTIONS)[number]['value']
export type OcrEngine = (typeof OCR_ENGINE_OPTIONS)[number]['value']

export const OCR_RECOGNITION_MODE_OPTIONS = [
  { value: 'fast', label: '快速', description: '识别更快，不支持中文、日文和韩文' },
  { value: 'accurate', label: '精确', description: '识别能力更强，但速度较慢' }
] as const

export type OcrRecognitionMode = (typeof OCR_RECOGNITION_MODE_OPTIONS)[number]['value']
export type MacOcrConfig = { engine: OcrEngine; recognitionMode: OcrRecognitionMode }
export type WindowsOcrConfig = {
  engine: OcrEngine
  language: OcrLanguage
  captureEngine: CaptureEngine
}
export type OcrConfig = MacOcrConfig | WindowsOcrConfig

export function isOcrRecognitionMode(value: unknown): value is OcrRecognitionMode {
  return OCR_RECOGNITION_MODE_OPTIONS.some((option) => option.value === value)
}

function hasOcrEngine(value: unknown): value is { engine: OcrEngine } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'engine' in value &&
    OCR_ENGINE_OPTIONS.some((option) => option.value === value.engine)
  )
}

export function isMacOcrConfig(value: unknown): value is MacOcrConfig {
  return (
    hasOcrEngine(value) && 'recognitionMode' in value && isOcrRecognitionMode(value.recognitionMode)
  )
}

export function isWindowsOcrConfig(value: unknown): value is WindowsOcrConfig {
  return (
    hasOcrEngine(value) &&
    'language' in value &&
    OCR_LANGUAGE_OPTIONS.some((option) => option.value === value.language) &&
    'captureEngine' in value &&
    CAPTURE_ENGINE_OPTIONS.some((option) => option.value === value.captureEngine)
  )
}

export function windowsOcrLanguage(config: WindowsOcrConfig): string | undefined {
  return config.language === 'system' ? undefined : config.language
}
