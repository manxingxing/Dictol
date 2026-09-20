export type AiProvider = 'openai-compatible'

export type AiLookupConfig = {
  enabled: boolean
  provider: AiProvider
  baseUrl: string
  model: string
}

export type AiLookupPublicConfig = AiLookupConfig & {
  hasApiKey: boolean
}

export type AiChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export const AI_TRANSLATION_LANGUAGES = [
  '中文',
  'English',
  '日本語',
  '한국어',
  'Français',
  'Deutsch'
] as const

export type AiTranslationLanguage = (typeof AI_TRANSLATION_LANGUAGES)[number]

export type AiChatRequest = {
  messages: AiChatMessage[]
  promptTarget?: 'sidebar' | 'selection-toolbar' | 'translation'
  translation?: {
    sourceLanguage: AiTranslationLanguage
    targetLanguage: AiTranslationLanguage
  }
  lookupContext?: {
    sourceText: string
  }
}

export type AiStreamEvent =
  { type: 'delta'; text: string } | { type: 'done' } | { type: 'error'; message: string }

export type AiSaveConfigRequest = AiLookupConfig & {
  apiKey?: string
}
