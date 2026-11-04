import type { OnlineTtsEngineId, TtsConfig } from '../shared/tts'
import { TtsCredentialStore } from './lib/tts-credentials'
import { synthesizeAzureSpeech } from './tts/azure-speech'
import { synthesizeElevenLabs } from './tts/elevenlabs'
import { synthesizeFishAudio } from './tts/fish-audio'
import { synthesizeOpenAiCompatible } from './tts/openai-compatible'

const MAX_AUDIO_BYTES = 12 * 1024 * 1024

type TtsProvider = (
  text: string,
  config: TtsConfig,
  key: string,
  signal: AbortSignal
) => Promise<Response>

const providers: Record<OnlineTtsEngineId, TtsProvider> = {
  'openai-compatible': synthesizeOpenAiCompatible,
  elevenlabs: synthesizeElevenLabs,
  'azure-speech': synthesizeAzureSpeech,
  'fish-audio': synthesizeFishAudio
}

export class TtsService {
  private readonly credentials = new TtsCredentialStore()

  getCredentials(): TtsCredentialStore {
    return this.credentials
  }

  async synthesize(text: string, config: TtsConfig, signal: AbortSignal): Promise<Uint8Array> {
    if (config.engine === 'system') throw new Error('系统朗读无需在线合成。')
    const key = this.credentials.get(config.engine)
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    const response = await providers[config.engine](text, config, key, requestSignal)
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500)
      throw new Error(`语音服务返回 ${response.status}${details ? `：${details}` : ''}`)
    }
    const length = Number(response.headers.get('content-length'))
    if (length > MAX_AUDIO_BYTES) throw new Error('语音服务返回的音频过大。')
    const audio = new Uint8Array(await response.arrayBuffer())
    if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES)
      throw new Error('语音服务未返回有效音频。')
    return audio
  }
}
