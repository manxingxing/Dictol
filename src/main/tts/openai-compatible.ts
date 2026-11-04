import type { TtsConfig } from '../../shared/tts'
import { createOpenAiClient } from '../lib/openai-client'

export function synthesizeOpenAiCompatible(
  text: string,
  config: TtsConfig,
  key: string,
  signal: AbortSignal
): Promise<Response> {
  const baseUrl = config.openai.baseUrl.trim().replace(/\/+$/, '')
  const endpoint = baseUrl.endsWith('/audio/speech')
    ? baseUrl
    : `${baseUrl}${baseUrl.endsWith('/v1') ? '' : '/v1'}/audio/speech`
  const url = checkedUrl(endpoint)
  const client = createOpenAiClient(url.replace(/\/audio\/speech$/, ''), key, 20_000)
  return client.audio.speech.create(
    {
      model: config.openai.model,
      input: text,
      voice: config.openai.voice,
      response_format: 'mp3'
    },
    { signal, headers: { Origin: new URL(url).origin } }
  )
}

function checkedUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('语音服务地址无效。')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('语音服务地址必须使用 HTTPS；本机服务可使用 HTTP。')
  }
  return url.toString()
}
