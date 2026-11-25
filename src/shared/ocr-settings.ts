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
export type OcrConfig = { engine: OcrEngine; language: OcrLanguage; captureEngine: CaptureEngine }

export function isOcrConfig(value: unknown): value is OcrConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'engine' in value &&
    OCR_ENGINE_OPTIONS.some((option) => option.value === value.engine) &&
    'language' in value &&
    OCR_LANGUAGE_OPTIONS.some((option) => option.value === value.language) &&
    'captureEngine' in value &&
    CAPTURE_ENGINE_OPTIONS.some((option) => option.value === value.captureEngine)
  )
}

export function windowsOcrLanguage(config: OcrConfig): string | undefined {
  return config.language === 'system' ? undefined : config.language
}
