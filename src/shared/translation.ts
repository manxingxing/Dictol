export const TRANSLATION_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'fr', 'de'] as const
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number]
export type TranslationSourceLanguage = TranslationLanguage | 'auto'

export const TRANSLATION_LANGUAGE_NAMES: Record<TranslationLanguage, string> = {
  zh: '中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语'
}

export const SYSTEM_TRANSLATION_PROVIDER_ID = 'system-translation'
export const TRANSLATION_MAX_TEXT_LENGTH = 10000
export const SELECTION_TRANSLATION_WIDTH = 520
export const SELECTION_TRANSLATION_INITIAL_HEIGHT = 264
export const SELECTION_TRANSLATION_MAX_HEIGHT = 760

export type SelectionTranslationShortcutStatus = {
  supported: boolean
  registered: boolean
  shortcut: string
}

export type SelectionTranslationShortcutResult = {
  ok: boolean
  status: SelectionTranslationShortcutStatus
  error?: string
}

export type ScreenshotTranslationStatus = {
  supported: boolean
  shortcut: string
  registered: boolean
}

export type ScreenshotTranslationSettingResult = {
  ok: boolean
  status: ScreenshotTranslationStatus
  error?: string
}

export type ClipboardTranslationStatus = {
  supported: boolean
  shortcut: string
  registered: boolean
}

export type ClipboardTranslationSettingResult = {
  ok: boolean
  status: ClipboardTranslationStatus
  error?: string
}

export type TranslationProviderKind =
  | 'system'
  | 'google'
  | 'microsoft'
  | 'volcano'
  | 'baidu'
  | 'deepl'
  | 'openai-compatible'
  | 'youdao-web'
  | 'google-web'
  | 'bing-web'

export type TranslationProviderConfig = {
  id: string
  kind: TranslationProviderKind
  name: string
  enabled: boolean
  options: Record<string, string>
}

export type TranslationConfig = {
  targetLanguage: TranslationLanguage
  providers: TranslationProviderConfig[]
}

export type TranslationPublicProvider = TranslationProviderConfig & {
  hasCredentials: boolean
  available: boolean
}

export type TranslationPublicConfig = {
  targetLanguage: TranslationLanguage
  providers: TranslationPublicProvider[]
}

export type TranslationSaveProviderRequest = TranslationProviderConfig & {
  credentials?: Record<string, string>
}

export type TranslationRequest = {
  providerId: string
  text: string
  sourceLanguage: TranslationSourceLanguage
  targetLanguage: TranslationLanguage
}

export type TranslationEvent =
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done'; detectedSourceLanguage?: string }
  | { requestId: string; type: 'error'; message: string }

export type TranslationApi = {
  getConfig: () => Promise<TranslationPublicConfig | null>
  start: (request: TranslationRequest) => Promise<string | null>
  cancel: (requestId: string) => void
  onEvent: (callback: (event: TranslationEvent) => void) => () => void
}

export type SelectionTranslationPayload = { text: string; version: number; pinned: boolean }
