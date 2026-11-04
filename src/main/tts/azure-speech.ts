import type { TtsConfig } from '../../shared/tts'

export function synthesizeAzureSpeech(
  text: string,
  config: TtsConfig,
  key: string,
  signal: AbortSignal
): Promise<Response> {
  if (!key) throw new Error('请先配置 Azure Speech API Key。')
  const region = config.azure.region.trim()
  if (!/^[a-z][a-z0-9-]{0,99}$/.test(region)) throw new Error('Azure Speech 区域无效。')
  const locale = /^[a-z]{2,3}-[A-Z]{2}/.exec(config.azure.voice)?.[0] ?? 'en-US'
  return fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/ssml+xml',
      'Ocp-Apim-Subscription-Key': key,
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'Dictol'
    },
    body: `<speak version="1.0" xml:lang="${locale}"><voice name="${escapeXml(config.azure.voice)}">${escapeXml(text)}</voice></speak>`,
    signal
  })
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char
  )
}
