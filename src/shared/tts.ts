export type TtsEngineId = 'system'

export type TtsConfig = {
  engine: TtsEngineId
  systemVoiceUri: string | null
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
