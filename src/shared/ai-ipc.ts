import type { AiProviderId } from './ai-settings'

export type AiProvider = 'openai-compatible'

export const AI_LOOKUP_MAX_SOURCE_TEXT_LENGTH = 20_000

export type AiLookupConfig = {
  enabled: boolean
  provider: AiProvider
  providerId: AiProviderId
  baseUrl: string
  model: string
  extraParams: string
}

export type AiLookupPublicConfig = AiLookupConfig & {
  hasApiKey: boolean
}

export type AiChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AiChatRequest = {
  messages: AiChatMessage[]
  promptTarget?: 'sidebar'
  lookupContext?: {
    sourceText: string
  }
}

export type AiStreamEvent =
  { type: 'delta'; text: string } | { type: 'done' } | { type: 'error'; message: string }

export type AiSaveConfigRequest = AiLookupConfig & {
  apiKey?: string
}

export type AiListModelsRequest = {
  baseUrl: string
  apiKey?: string
}
