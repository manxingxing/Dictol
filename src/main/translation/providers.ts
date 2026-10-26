import { createAiCompletionBody } from '../ai-model-adapter'
import type {
  TranslationProviderConfig,
  TranslationProviderKind,
  TranslationRequest
} from '../../shared/translation'
import { TRANSLATION_LANGUAGE_NAMES } from '../../shared/translation'
import { translateWithSystem } from './system'
import { translateWithVolcano } from './volcano'
import { translateWithBaidu } from './baidu'
import { translateWithYoudaoWeb } from './youdao-web'
import { translateWithGoogleWeb } from './google-web'
import { translateWithBingWeb } from './bing-web'

export type TranslationAdapterContext = {
  config: TranslationProviderConfig
  credentials: Record<string, string>
  request: TranslationRequest
  signal: AbortSignal
  onDelta: (text: string) => void
}

export type TranslationAdapter = (
  context: TranslationAdapterContext
) => Promise<{ text: string; detectedSourceLanguage?: string }>

export const adapters: Record<TranslationProviderKind, TranslationAdapter> = {
  system: ({ request, signal }) => translateWithSystem(request, signal),
  'openai-compatible': translateWithOpenAiCompatible,
  google: translateWithGoogle,
  'youdao-web': translateWithYoudaoWeb,
  'google-web': translateWithGoogleWeb,
  'bing-web': translateWithBingWeb,
  microsoft: translateWithMicrosoft,
  volcano: ({ request, credentials, signal }) => translateWithVolcano(request, credentials, signal),
  baidu: translateWithBaidu,
  deepl: translateWithDeepL
}

async function translateWithGoogle({
  request,
  credentials,
  signal
}: TranslationAdapterContext): ReturnType<TranslationAdapter> {
  const response = await fetch('https://translation.googleapis.com/language/translate/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': credentials.apiKey },
    body: JSON.stringify({
      q: request.text,
      target: request.targetLanguage,
      ...(request.sourceLanguage === 'auto' ? {} : { source: request.sourceLanguage }),
      format: 'text'
    }),
    signal
  })
  const data = (await response.json()) as {
    data?: { translations?: Array<{ translatedText?: string; detectedSourceLanguage?: string }> }
    error?: { message?: string }
  }
  if (!response.ok)
    throw new Error(data.error?.message || `Google 翻译请求失败（${response.status}）。`)
  const result = data.data?.translations?.[0]
  if (!result?.translatedText) throw new Error('Google 翻译没有返回译文。')
  return { text: result.translatedText, detectedSourceLanguage: result.detectedSourceLanguage }
}

async function translateWithMicrosoft({
  config,
  request,
  credentials,
  signal
}: TranslationAdapterContext): ReturnType<TranslationAdapter> {
  const endpoint = (
    config.options.endpoint || 'https://api.cognitive.microsofttranslator.com'
  ).replace(/\/$/, '')
  const endpointUrl = new URL(endpoint)
  const path =
    endpointUrl.hostname === 'api.cognitive.microsofttranslator.com' ||
    endpointUrl.pathname.includes('/translator/text/v3.0')
      ? '/translate'
      : '/translator/text/v3.0/translate'
  const url = new URL(`${endpoint}${path}`)
  url.searchParams.set('api-version', '3.0')
  url.searchParams.set('to', request.targetLanguage)
  if (request.sourceLanguage !== 'auto') url.searchParams.set('from', request.sourceLanguage)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': credentials.apiKey,
      ...(config.options.region ? { 'Ocp-Apim-Subscription-Region': config.options.region } : {})
    },
    body: JSON.stringify([{ Text: request.text }]),
    signal
  })
  const data = (await response.json()) as
    | Array<{ detectedLanguage?: { language?: string }; translations?: Array<{ text?: string }> }>
    | { error?: { message?: string } }
  if (!response.ok || !Array.isArray(data)) {
    const error = Array.isArray(data) ? undefined : data.error?.message
    throw new Error(error || `Microsoft 翻译请求失败（${response.status}）。`)
  }
  const result = data[0]
  const text = result?.translations?.[0]?.text
  if (!text) throw new Error('Microsoft 翻译没有返回译文。')
  return { text, detectedSourceLanguage: result.detectedLanguage?.language }
}

async function translateWithDeepL({
  config,
  request,
  credentials,
  signal
}: TranslationAdapterContext): ReturnType<TranslationAdapter> {
  const host = config.options.plan === 'free' ? 'api-free.deepl.com' : 'api.deepl.com'
  const response = await fetch(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `DeepL-Auth-Key ${credentials.apiKey}`
    },
    body: JSON.stringify({
      text: [request.text],
      target_lang: request.targetLanguage === 'en' ? 'EN-US' : request.targetLanguage.toUpperCase(),
      ...(request.sourceLanguage === 'auto'
        ? {}
        : { source_lang: request.sourceLanguage.toUpperCase() })
    }),
    signal
  })
  const data = (await response.json()) as {
    message?: string
    translations?: Array<{ text?: string; detected_source_language?: string }>
  }
  if (!response.ok) throw new Error(data.message || `DeepL 翻译请求失败（${response.status}）。`)
  const result = data.translations?.[0]
  if (!result?.text) throw new Error('DeepL 翻译没有返回译文。')
  return { text: result.text, detectedSourceLanguage: result.detected_source_language }
}

async function translateWithOpenAiCompatible({
  config,
  request,
  credentials,
  signal,
  onDelta
}: TranslationAdapterContext): ReturnType<TranslationAdapter> {
  const source =
    request.sourceLanguage === 'auto'
      ? '自动识别的源语言'
      : TRANSLATION_LANGUAGE_NAMES[request.sourceLanguage]
  const target = TRANSLATION_LANGUAGE_NAMES[request.targetLanguage]
  const response = await fetch(`${config.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {})
    },
    body: JSON.stringify(
      createAiCompletionBody({
        model: config.options.model,
        stream: true,
        messages: [
          {
            role: 'system',
            content: getTranslationSystemPrompt(source, target)
          },
          { role: 'user', content: request.text }
        ]
      })
    ),
    signal
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`模型翻译请求失败（${response.status}）：${message.slice(0, 300)}`)
  }
  if (!response.body) throw new Error('模型没有返回可读取的响应。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let completed = false
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    if (done && buffer) {
      lines.push(buffer)
      buffer = ''
    }
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') {
        completed = true
        continue
      }
      if (!data) continue
      const event = JSON.parse(data) as {
        error?: { message?: string }
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
      }
      if (event.error) throw new Error(event.error.message || '模型翻译失败。')
      const choice = event.choices?.[0]
      if (choice?.finish_reason === 'length') throw new Error('模型输出达到长度上限，译文不完整。')
      if (choice?.finish_reason) completed = true
      const delta = choice?.delta?.content
      if (delta) {
        text += delta
        onDelta(delta)
      }
    }
    if (done) break
  }
  if (!completed || !text.trim()) throw new Error('模型翻译未正常完成。')
  return { text }
}

function getTranslationSystemPrompt(source: string, target: string): string {
  return `你是一名专业、地道的翻译专家。请将用户提供的内容从${source}翻译成${target}，达到母语者的表达水准。

## 翻译要求
1. 忠实传达原意，同时符合目标语言表达习惯，避免翻译腔；主动避免过度使用被动语态、冗余连接词和堆叠抽象名词。
2. 保留原文的语气、风格、格式和段落结构；专有名词、数字、代码、URL 与 Markdown 标记准确处理，必要时可按目标语言习惯调整标记位置，但不得增删。
3. 术语使用公认的权威译法；无标准译法的专有名词保留原文，不加注释。
4. 除非用户明确要求解释，否则只输出译文，不添加前言、注释或语言标签（如"翻译如下："）。

## 内部流程（不要输出）
先完整理解原文并形成流畅的译文草稿，再静默检查是否有误译、漏译、翻译腔和格式错误，修正后只输出最终译文。`
}
