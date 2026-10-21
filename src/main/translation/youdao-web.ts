import { createDecipheriv, createHash } from 'node:crypto'
import type { TranslationAdapter } from './providers'

const ENDPOINT = 'https://dict.youdao.com/webtranslate'
const HOME_PAGE = 'https://fanyi.youdao.com/'
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://fanyi.youdao.com/'
}
const CLIENT = 'fanyideskweb'
const PRODUCT = 'webfanyi'

const LANGUAGE_CODES = {
  zh: 'zh-CHS',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  auto: 'auto'
} as const

type WebKey = {
  code: number
  data?: { secretKey?: string; aesKey?: string; aesIv?: string }
}

type WebTranslation = {
  code: number
  type?: string
  translateResult?: Array<Array<{ tgt?: string }>>
}

async function getSessionCookie(signal: AbortSignal): Promise<string> {
  const response = await fetch(HOME_PAGE, { headers: HEADERS, signal })
  if (!response.ok) throw new Error(`有道网页版建立翻译会话失败（${response.status}）。`)
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';', 1)[0])
    .find((value) => value.startsWith('OUTFOX_SEARCH_USER_ID='))
  if (!cookie) throw new Error('有道网页版没有返回翻译会话信息。')
  return cookie
}

function sign(timestamp: string, key: string): string {
  return createHash('md5')
    .update(`client=${CLIENT}&mysticTime=${timestamp}&product=${PRODUCT}&key=${key}`)
    .digest('hex')
}

function parameters(timestamp: string, keyId: string, signature: string): URLSearchParams {
  return new URLSearchParams({
    client: CLIENT,
    product: PRODUCT,
    appVersion: '1.0.0',
    vendor: 'web',
    pointParam: 'client,mysticTime,product',
    keyfrom: 'fanyi.web',
    keyid: keyId,
    sign: signature,
    mysticTime: timestamp
  })
}

export const translateWithYoudaoWeb: TranslationAdapter = async ({ request, signal }) => {
  const keyTime = Date.now().toString()
  const keyUrl = new URL(`${ENDPOINT}/key`)
  keyUrl.search = parameters(
    keyTime,
    'webfanyi-key-getter',
    sign(keyTime, 'asdjnjfenknafdfsdfsd')
  ).toString()
  const [keyResponse, sessionCookie] = await Promise.all([
    fetch(keyUrl, { headers: HEADERS, signal }),
    getSessionCookie(signal)
  ])
  if (!keyResponse.ok) throw new Error(`有道网页版获取翻译密钥失败（${keyResponse.status}）。`)
  const key = (await keyResponse.json()) as WebKey
  if (key.code !== 0 || !key.data?.secretKey || !key.data.aesKey || !key.data.aesIv) {
    throw new Error('有道网页版没有返回有效的翻译密钥。')
  }

  const time = Date.now().toString()
  const body = parameters(time, 'webfanyi', sign(time, key.data.secretKey))
  body.set('i', request.text)
  body.set('from', LANGUAGE_CODES[request.sourceLanguage])
  body.set('to', LANGUAGE_CODES[request.targetLanguage])
  body.set('dictResult', 'false')
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { ...HEADERS, Cookie: sessionCookie },
    body,
    signal
  })
  if (!response.ok) throw new Error(`有道网页版翻译请求失败（${response.status}）。`)

  const encrypted = (await response.text()).trim().replace(/-/g, '+').replace(/_/g, '/')
  let result: WebTranslation
  try {
    const decipher = createDecipheriv(
      'aes-128-cbc',
      createHash('md5').update(key.data.aesKey).digest(),
      createHash('md5').update(key.data.aesIv).digest()
    )
    const decoded = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final()
    ])
    result = JSON.parse(decoded.toString('utf8')) as WebTranslation
  } catch {
    throw new Error('有道网页版译文解密失败。')
  }

  if (result.code !== 0) throw new Error(`有道网页版翻译失败（${result.code}）。`)
  const text = result.translateResult
    ?.map((group) => group.map((item) => item.tgt ?? '').join(''))
    .join('')
  if (!text?.trim()) throw new Error('有道网页版没有返回译文。')
  return { text, detectedSourceLanguage: result.type?.split('2')[0] }
}
