import type { TranslationAdapter } from './providers'

const LANGUAGE_CODES = {
  zh: 'zh-CN',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  auto: 'auto'
} as const

type GoogleResponse = {
  src?: string
  sentences?: Array<{ trans?: string }>
}

export const translateWithGoogleWeb: TranslationAdapter = async ({ request, signal }) => {
  if (request.text.length > 5000) {
    throw new Error('Google 翻译网页版最多支持 5000 个字符。')
  }
  const url = new URL('https://translate.googleapis.com/translate_a/single')
  url.search = new URLSearchParams({
    client: 'gtx',
    sl: LANGUAGE_CODES[request.sourceLanguage],
    tl: LANGUAGE_CODES[request.targetLanguage],
    dt: 't',
    dj: '1',
    ie: 'UTF-8',
    q: request.text
  }).toString()
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    },
    signal
  })
  if (response.status === 429) {
    throw new Error('Google 翻译网页版请求过于频繁（429），请稍后重试。')
  }
  if (!response.ok) throw new Error(`Google 翻译网页版请求失败（${response.status}）。`)
  const result = (await response.json()) as GoogleResponse
  const text = result.sentences?.map((sentence) => sentence.trans ?? '').join('')
  if (!text?.trim()) throw new Error('Google 翻译网页版没有返回译文。')
  return { text, detectedSourceLanguage: result.src }
}
