import { createHash, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { TranslationAdapter } from './providers'

const ENDPOINT = 'https://fanyi-api.baidu.com/api/trans/vip/translate'
const MAX_QUERY_LENGTH = 1000
const REQUEST_INTERVAL_MS = 1100
const languageCodes = {
  zh: 'zh',
  en: 'en',
  ja: 'jp',
  ko: 'kor',
  fr: 'fra',
  de: 'de',
  auto: 'auto'
} as const

const errorMessages: Record<string, string> = {
  '52003': 'APP ID 无效或尚未开通通用文本翻译。',
  '54001': '签名错误，请检查密钥。',
  '54003': '请求频率超限，请稍后重试。',
  '54004': '账户余额不足。',
  '58000': '当前 IP 不在百度翻译允许的地址范围内。',
  '58001': '不支持该语言方向。',
  '58002': '通用文本翻译服务已关闭。'
}

type BaiduResponse = {
  from?: string
  trans_result?: Array<{ dst?: string }>
  error_code?: string | number
  error_msg?: string
}

let nextRequestAt = 0
let requestQueue = Promise.resolve()

export const translateWithBaidu: TranslationAdapter = async ({
  config,
  credentials,
  request,
  signal
}) => {
  const translations: string[] = []
  let detectedSourceLanguage: string | undefined

  for (const query of splitQuery(request.text)) {
    if (!query.trim()) {
      translations.push(query)
      continue
    }
    await waitForRequestSlot(signal)
    const salt = randomBytes(8).toString('hex')
    const appId = config.options.appId
    const sign = createHash('md5')
      .update(`${appId}${query}${salt}${credentials.secretKey}`, 'utf8')
      .digest('hex')
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        q: query,
        from: languageCodes[request.sourceLanguage],
        to: languageCodes[request.targetLanguage],
        appid: appId,
        salt,
        sign
      }),
      signal
    })
    const data = (await response.json().catch(() => null)) as BaiduResponse | null
    if (!data || typeof data !== 'object') {
      throw new Error(`百度翻译返回了无效响应（HTTP ${response.status}）。`)
    }
    const errorCode = data.error_code === undefined ? '' : String(data.error_code)
    if (!response.ok || (errorCode && errorCode !== '52000')) {
      const detail = errorMessages[errorCode] || data.error_msg || `HTTP ${response.status}`
      throw new Error(`百度翻译请求失败${errorCode ? `（${errorCode}）` : ''}：${detail}`)
    }
    const results = data.trans_result
    if (!results?.length || results.some((result) => typeof result.dst !== 'string')) {
      throw new Error('百度翻译没有返回译文。')
    }
    translations.push(results.map((result) => result.dst).join('\n'))
    detectedSourceLanguage ??=
      data.from === 'jp'
        ? 'ja'
        : data.from === 'kor'
          ? 'ko'
          : data.from === 'fra'
            ? 'fr'
            : data.from
  }

  return { text: translations.join('\n'), detectedSourceLanguage }
}

function splitQuery(text: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + MAX_QUERY_LENGTH, text.length)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1
    if (end < text.length) {
      const candidate = text.slice(start, end)
      const boundary = Math.max(
        ...['\n', '。', '！', '？', '.', '!', '?', '；', ';', ' '].map((mark) =>
          candidate.lastIndexOf(mark)
        )
      )
      if (boundary >= MAX_QUERY_LENGTH / 2) end = start + boundary + 1
    }
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

async function waitForRequestSlot(signal: AbortSignal): Promise<void> {
  let release!: () => void
  const turn = new Promise<void>((resolve) => {
    release = resolve
  })
  const previous = requestQueue
  requestQueue = turn
  await previous
  try {
    const wait = Math.max(0, nextRequestAt - Date.now())
    if (wait) await delay(wait, undefined, { signal })
    if (signal.aborted) throw signal.reason
    nextRequestAt = Date.now() + REQUEST_INTERVAL_MS
  } finally {
    release()
  }
}
