import type { TranslationAdapter } from './providers'

const LANGUAGE_CODES = {
  zh: 'zh-Hans',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  auto: 'auto-detect'
} as const

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
}

type BingSession = {
  origin: string
  ig: string
  iid: string
  key: string
  token: string
  expiresAt: number
}

type BingResult =
  | Array<{
      detectedLanguage?: { language?: string }
      translations?: Array<{ text?: string }>
    }>
  | { statusCode?: number }

let cachedSession: BingSession | undefined

async function getSession(signal: AbortSignal): Promise<BingSession> {
  if (cachedSession && cachedSession.expiresAt > Date.now()) return cachedSession
  const response = await fetch('https://cn.bing.com/translator', { headers: HEADERS, signal })
  if (!response.ok) throw new Error(`Bing 网页版初始化失败（${response.status}）。`)
  const html = await response.text()
  const ig = html.match(/IG:\s*"([^"]+)"/)?.[1]
  const iid = html.match(/data-iid\s*=\s*"([^"]+)"/)?.[1]
  const raw = html.match(/params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]/)?.[1]
  const [key, token, lifetime] =
    raw?.split(',').map((part) => part.trim().replace(/^"|"$/g, '')) ?? []
  if (!ig || !iid || !key || !token) throw new Error('Bing 网页版没有返回翻译会话参数。')
  const finalUrl = new URL(response.url)
  if (finalUrl.protocol !== 'https:' || !/(^|\.)bing\.com$/i.test(finalUrl.hostname)) {
    throw new Error('Bing 网页版跳转到了无效的服务地址。')
  }
  const lifetimeMs = Number(lifetime)
  cachedSession = {
    origin: finalUrl.origin,
    ig,
    iid,
    key,
    token,
    expiresAt: Date.now() + (Number.isFinite(lifetimeMs) ? lifetimeMs / 2 : 30 * 60_000)
  }
  return cachedSession
}

async function requestTranslation(
  session: BingSession,
  text: string,
  from: string,
  to: string,
  signal: AbortSignal
): Promise<BingResult> {
  const url = new URL('/ttranslatev3', session.origin)
  url.search = new URLSearchParams({ isVertical: '1', IG: session.ig, IID: session.iid }).toString()
  const response = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: new URLSearchParams({
      text,
      fromLang: from,
      to,
      token: session.token,
      key: session.key,
      tryFetchingGenderDebiasedTranslations: 'true'
    }),
    signal
  })
  if (!response.ok) throw new Error(`Bing 翻译网页版请求失败（${response.status}）。`)
  return (await response.json()) as BingResult
}

export const translateWithBingWeb: TranslationAdapter = async ({ request, signal }) => {
  if (request.text.length > 1000) {
    throw new Error('Bing 翻译网页版最多支持 1000 个字符。')
  }
  let session = await getSession(signal)
  let result = await requestTranslation(
    session,
    request.text,
    LANGUAGE_CODES[request.sourceLanguage],
    LANGUAGE_CODES[request.targetLanguage],
    signal
  )
  if (!Array.isArray(result) && result.statusCode === 205) {
    cachedSession = undefined
    session = await getSession(signal)
    result = await requestTranslation(
      session,
      request.text,
      LANGUAGE_CODES[request.sourceLanguage],
      LANGUAGE_CODES[request.targetLanguage],
      signal
    )
  }
  if (!Array.isArray(result))
    throw new Error(`Bing 翻译网页版返回错误（${result.statusCode ?? '未知'}）。`)
  const first = result[0]
  const text = first?.translations?.[0]?.text
  if (!text?.trim()) throw new Error('Bing 翻译网页版没有返回译文。')
  return { text, detectedSourceLanguage: first.detectedLanguage?.language }
}
