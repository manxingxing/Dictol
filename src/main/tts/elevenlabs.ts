import type { TtsConfig } from '../../shared/tts'

export function synthesizeElevenLabs(
  text: string,
  config: TtsConfig,
  key: string,
  signal: AbortSignal
): Promise<Response> {
  if (!key) throw new Error('请先配置 ElevenLabs API Key。')
  if (!config.elevenlabs.voiceId) throw new Error('请先配置 ElevenLabs Voice ID。')
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenlabs.voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
      body: JSON.stringify({ text, model_id: config.elevenlabs.model }),
      signal
    }
  )
}
