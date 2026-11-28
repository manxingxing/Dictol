import { SELECTION_EXPLANATION_MAX_WORD_LENGTH } from './selection-explanation'
import { TRANSLATION_MAX_TEXT_LENGTH } from './translation'

export const DEEP_LINK_SCHEME = 'dictol'
const DEEP_LINK_PROTOCOL = `${DEEP_LINK_SCHEME}:`

export type DeepLinkIntent = {
  type: 'dict' | 'lookup' | 'translate'
  text: string
}

export function parseDeepLink(value: unknown): DeepLinkIntent | null {
  if (typeof value !== 'string' || !value.toLowerCase().startsWith(DEEP_LINK_PROTOCOL)) {
    return null
  }

  const match = /^\/\/([^/]+)\/([^/?#]+)$/.exec(value.slice(DEEP_LINK_PROTOCOL.length))
  const type = match?.[1].toLowerCase()
  if (!match || (type !== 'dict' && type !== 'lookup' && type !== 'translate')) {
    throw new Error('Deep Link 必须包含受支持的路由和一段经过 URL 编码的文本。')
  }

  const text = decodeURIComponent(match[2]).trim()
  if (!text) throw new Error('Deep Link 文本不能为空。')
  if (
    (type === 'lookup' && text.length > SELECTION_EXPLANATION_MAX_WORD_LENGTH) ||
    (type === 'translate' && text.length > TRANSLATION_MAX_TEXT_LENGTH)
  ) {
    throw new Error('Deep Link 文本超出长度限制。')
  }

  return { type, text }
}

export function findDeepLink(values: readonly unknown[]): DeepLinkIntent | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const deepLink = parseDeepLink(values[index])
    if (deepLink) return deepLink
  }
  return null
}
