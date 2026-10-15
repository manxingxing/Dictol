import { createHash, createHmac } from 'node:crypto'
import type { TranslationRequest } from '../../shared/translation'

const HOST = 'translate.volcengineapi.com'
const REGION = 'cn-north-1'
const SERVICE = 'translate'
const QUERY = 'Action=TranslateText&Version=2020-06-01'

export async function translateWithVolcano(
  request: TranslationRequest,
  credential: Record<string, string>,
  signal: AbortSignal
): Promise<{ text: string; detectedSourceLanguage?: string }> {
  const body = JSON.stringify({
    ...(request.sourceLanguage === 'auto' ? {} : { SourceLanguage: request.sourceLanguage }),
    TargetLanguage: request.targetLanguage,
    TextList: [request.text]
  })
  const date = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
  const day = date.slice(0, 8)
  const bodyHash = sha256(body)
  const signedHeaders = 'content-type;host;x-content-sha256;x-date'
  const canonicalHeaders =
    `content-type:application/json\nhost:${HOST}\n` +
    `x-content-sha256:${bodyHash}\nx-date:${date}\n`
  const scope = `${day}/${REGION}/${SERVICE}/request`
  const canonicalRequest = ['POST', '/', QUERY, canonicalHeaders, signedHeaders, bodyHash].join(
    '\n'
  )
  const stringToSign = ['HMAC-SHA256', date, scope, sha256(canonicalRequest)].join('\n')
  const signingKey = hmac(
    hmac(hmac(hmac(credential.secretAccessKey, day), REGION), SERVICE),
    'request'
  )
  const signature = hmac(signingKey, stringToSign).toString('hex')
  const response = await fetch(`https://${HOST}/?${QUERY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Date': date,
      'X-Content-Sha256': bodyHash,
      Authorization:
        `HMAC-SHA256 Credential=${credential.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`
    },
    body,
    signal
  })
  const data = (await response.json()) as {
    ResponseMetadata?: { Error?: { Message?: string } | null }
    TranslationList?: Array<{ Translation?: string; DetectedSourceLanguage?: string }>
  }
  if (!response.ok || data.ResponseMetadata?.Error) {
    throw new Error(
      data.ResponseMetadata?.Error?.Message || `火山翻译请求失败（${response.status}）。`
    )
  }
  const result = data.TranslationList?.[0]
  if (!result?.Translation) throw new Error('火山翻译没有返回译文。')
  return { text: result.Translation, detectedSourceLanguage: result.DetectedSourceLanguage }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}
