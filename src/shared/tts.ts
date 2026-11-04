export type TtsEngineId =
  'system' | 'openai-compatible' | 'elevenlabs' | 'azure-speech' | 'fish-audio'
export type OnlineTtsEngineId = Exclude<TtsEngineId, 'system'>

export type TtsConfig = {
  engine: TtsEngineId
  systemVoiceUri: string | null
  openai: { baseUrl: string; model: string; voice: string }
  elevenlabs: { model: string; voiceId: string }
  azure: { region: string; voice: string }
  fish: { model: string; voiceId: string }
}

export type TtsCredentialsStatus = Record<OnlineTtsEngineId, boolean>
export type TtsSaveSettingsRequest = {
  config: TtsConfig
  apiKey?: { provider: OnlineTtsEngineId; value: string }
}

export type TtsVoice = {
  uri: string
  name: string
  lang: string
  isDefault: boolean
}

export type TtsState = 'waiting' | 'playing' | 'completed' | 'aborted' | 'error'

export type TtsStateListener = (state: TtsState, message?: string) => void

export type TtsPlayback = {
  speak: (text: string, onStateChange: TtsStateListener) => void
  stop: () => void
}
