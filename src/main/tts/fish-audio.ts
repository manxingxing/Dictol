import type { TtsConfig } from '../../shared/tts'

export function synthesizeFishAudio(
  text: string,
  config: TtsConfig,
  key: string,
  signal: AbortSignal
): Promise<Response> {
  if (!key) throw new Error('请先配置 Fish Audio API Key。')
  if (!config.fish.model.trim()) throw new Error('请先配置 Fish Audio 模型。')
  return fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      model: config.fish.model.trim()
    },
    body: JSON.stringify({
      text,
      format: 'mp3',
      ...(config.fish.voiceId.trim() ? { reference_id: config.fish.voiceId.trim() } : {})
    }),
    signal
  })
}
