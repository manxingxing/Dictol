export const AI_PROVIDER_PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'siliconflow', label: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1' }
] as const

export type AiProviderId = 'custom' | (typeof AI_PROVIDER_PRESETS)[number]['id']
export const AI_BASE_URL_MAX_LENGTH = 500

export function isAiProviderId(value: unknown): value is AiProviderId {
  return value === 'custom' || AI_PROVIDER_PRESETS.some((preset) => preset.id === value)
}

export function normalizeAiBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '')
  try {
    const url = new URL(normalized)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return ''
    }
    return normalized
  } catch {
    return ''
  }
}

export function parseAiExtraParams(value: string): Record<string, unknown> {
  if (!value.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('额外参数必须是有效的 JSON。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('额外参数必须是 JSON 对象，例如 { "temperature": 0.5 }。')
  }
  if ('stream' in parsed && typeof parsed.stream !== 'boolean') {
    throw new Error('额外参数 stream 必须是 true 或 false。')
  }
  return parsed as Record<string, unknown>
}
