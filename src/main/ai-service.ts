import type {
  AiChatMessage,
  AiChatRequest,
  AiLookupPublicConfig,
  AiListModelsRequest,
  AiSaveConfigRequest,
  AiStreamEvent
} from '../shared/ai-ipc'
import { randomUUID } from 'node:crypto'
import {
  AI_BASE_URL_MAX_LENGTH,
  AI_PROVIDER_PRESETS,
  normalizeAiBaseUrl,
  parseAiExtraParams
} from '../shared/ai-settings'
import { AppConfigStore } from './app-config'
import { AiCredentialStore } from './ai-credentials'
import {
  getExcerptNoteSystemPrompt,
  getOcrContextSystemPrompt,
  getLookupSystemPrompt,
  prepareLookupMessages
} from './language-task-prompts'
import { createAiCompletionBody } from './ai-model-adapter'
import { createOpenAiClient } from './lib/openai-client'
import type { OcrAiExplanation } from '../shared/ocr'

const MAX_MESSAGES = 100
const MAX_MESSAGE_LENGTH = 20_000
const REQUEST_TIMEOUT_MS = 120_000
const VERIFICATION_TIMEOUT_MS = 30_000

export type AiStreamHandler = (event: AiStreamEvent) => void
export type AiPromptTarget = 'sidebar' | 'excerpt' | 'ocr-context'
type AiLookupContext = NonNullable<AiChatRequest['lookupContext']> & {
  hasRelatedTerms?: boolean
}

export class AiLookupService {
  private readonly credentials: AiCredentialStore
  private readonly requests = new Map<string, AbortController>()

  constructor(private readonly appConfig: AppConfigStore) {
    this.credentials = new AiCredentialStore()
  }

  getPublicConfig(): AiLookupPublicConfig {
    const config = this.appConfig.load().aiLookup
    return {
      ...config,
      hasApiKey: Boolean(this.credentials.getApiKey())
    }
  }

  saveConfig(input: AiSaveConfigRequest): ReturnType<AiLookupService['getPublicConfig']> {
    const baseUrl = normalizeAiBaseUrl(
      AI_PROVIDER_PRESETS.find((preset) => preset.id === input.providerId)?.baseUrl ?? input.baseUrl
    )
    const model = input.model.trim()
    if (!baseUrl) throw new Error('请填写服务地址。')
    if (baseUrl.length > AI_BASE_URL_MAX_LENGTH) throw new Error('服务地址不能超过 500 个字符。')
    if (model.length > 200) throw new Error('模型名称不能超过 200 个字符。')

    parseAiExtraParams(input.extraParams)
    const current = this.appConfig.load()
    const endpointChanged = baseUrl !== normalizeAiBaseUrl(current.aiLookup.baseUrl)
    try {
      this.appConfig.save({
        ...current,
        aiLookup: {
          enabled: input.enabled,
          provider: 'openai-compatible',
          providerId: input.providerId,
          baseUrl,
          model,
          extraParams: input.extraParams.trim()
        }
      })
      if (input.apiKey?.trim() || endpointChanged) this.credentials.saveApiKey(input.apiKey ?? '')
    } catch (error) {
      this.appConfig.save(current)
      throw error
    }
    return this.getPublicConfig()
  }

  async listModels(input: AiListModelsRequest): Promise<string[]> {
    const baseUrl = normalizeAiBaseUrl(input.baseUrl)
    if (!baseUrl) throw new Error('请填写有效的服务地址。')
    const client = createOpenAiClient(baseUrl, this.resolveApiKey(input), VERIFICATION_TIMEOUT_MS)
    const page = await client.models.list()
    if (!Array.isArray(page.data) || page.data.some((model) => typeof model?.id !== 'string')) {
      throw new Error('模型列表格式无效，仍可手动输入模型名称。')
    }
    return [...new Set(page.data.map((model) => model.id).filter(Boolean))].sort()
  }

  private resolveApiKey(input: AiListModelsRequest): string {
    if (input.apiKey?.trim()) return input.apiKey.trim()
    const saved = this.appConfig.load().aiLookup
    return normalizeAiBaseUrl(input.baseUrl) === normalizeAiBaseUrl(saved.baseUrl)
      ? this.credentials.getApiKey()
      : ''
  }

  async testConfig(input?: AiSaveConfigRequest): Promise<void> {
    const config = input ?? this.appConfig.load().aiLookup
    const baseUrl = normalizeAiBaseUrl(config.baseUrl)
    if (!baseUrl) throw new Error('请填写有效的服务地址。')
    if (!config.model) throw new Error('请先在设置中配置模型名称。')
    const apiKey = this.resolveApiKey(config)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VERIFICATION_TIMEOUT_MS)
    try {
      const client = createOpenAiClient(baseUrl, apiKey, VERIFICATION_TIMEOUT_MS)
      const completion = await client.chat.completions.create(
        createAiCompletionBody({
          model: config.model,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          stream: false,
          extraParams: config.extraParams
        }),
        { signal: controller.signal }
      )
      let content = ''
      if ('choices' in completion) {
        content = completion.choices[0]?.message.content ?? ''
      } else {
        for await (const chunk of completion) content += chunk.choices[0]?.delta.content ?? ''
      }
      if (typeof content !== 'string' || !content.trim())
        throw new Error('AI 服务没有返回有效内容。')
    } catch (error) {
      if (controller.signal.aborted) throw new Error('验证超时，请重试。')
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async *stream(
    requestId: string,
    messages: AiChatMessage[],
    promptTarget: AiPromptTarget,
    lookupContext?: AiLookupContext,
    onEvent?: AiStreamHandler
  ): AsyncGenerator<AiStreamEvent, void> {
    const controller = new AbortController()
    this.cancel(requestId)
    this.requests.set(requestId, controller)
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const send = (event: AiStreamEvent): void => onEvent?.(event)

    try {
      const config = this.appConfig.load().aiLookup
      if (!config.enabled) throw new Error('AI 查词尚未开启。')
      if (!config.model) throw new Error('请先在设置中配置模型名称。')
      const apiKey = this.credentials.getApiKey()
      const bodyMessages = validateMessages(messages)
      let systemPrompt: string
      let requestMessages = bodyMessages

      if (promptTarget === 'ocr-context') {
        systemPrompt = getOcrContextSystemPrompt()
      } else if (promptTarget === 'excerpt') {
        systemPrompt = getExcerptNoteSystemPrompt(lookupContext?.hasRelatedTerms ?? true)
        if (!lookupContext) throw new Error('摘抄上下文缺失。')
        requestMessages = prepareLookupMessages(lookupContext.sourceText, bodyMessages)
      } else {
        if (!lookupContext) throw new Error('查词上下文缺失。')
        const followUp = bodyMessages.some((message) => message.role === 'assistant')
        systemPrompt = getLookupSystemPrompt(followUp)
        requestMessages = prepareLookupMessages(lookupContext.sourceText, bodyMessages)
      }

      const client = createOpenAiClient(config.baseUrl, apiKey, REQUEST_TIMEOUT_MS)
      const completionBody = createAiCompletionBody({
        model: config.model,
        messages: [{ role: 'system', content: systemPrompt }, ...requestMessages],
        stream: promptTarget !== 'ocr-context',
        extraParams: config.extraParams
      })
      if (!completionBody.stream) {
        const completion = await client.chat.completions.create(
          { ...completionBody, stream: false },
          { signal: controller.signal }
        )
        const choice = completion.choices[0]
        if (['length', 'max_tokens'].includes(choice?.finish_reason ?? '')) {
          throw new Error('AI 输出达到长度上限，结果不完整，请重试。')
        }
        const content = choice?.message?.content
        if (typeof content !== 'string') throw new Error('AI 未返回有效内容。')
        const event: AiStreamEvent = { type: 'delta', text: content }
        send(event)
        yield event
        const done: AiStreamEvent = { type: 'done' }
        send(done)
        yield done
        return
      }
      const stream = await client.chat.completions.create(
        { ...completionBody, stream: true },
        { signal: controller.signal }
      )
      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        if (['length', 'max_tokens'].includes(choice?.finish_reason ?? '')) {
          throw new Error('AI 输出达到长度上限，结果不完整，请重试。')
        }
        const content = choice?.delta.content
        if (!content) continue
        const event: AiStreamEvent = { type: 'delta', text: content }
        send(event)
        yield event
      }
      const event: AiStreamEvent = { type: 'done' }
      send(event)
      yield event
    } catch (error) {
      if (controller.signal.aborted) return
      const event: AiStreamEvent = {
        type: 'error',
        message: error instanceof Error ? error.message : 'AI 请求失败。'
      }
      send(event)
      yield event
    } finally {
      clearTimeout(timeout)
      if (this.requests.get(requestId) === controller) this.requests.delete(requestId)
    }
  }

  async generateExcerptNote(excerpt: string, relatedTerms: string[]): Promise<string> {
    const hasRelatedTerms = relatedTerms.length > 0
    const sourceText = JSON.stringify(
      hasRelatedTerms ? { 原句: excerpt, 词语: relatedTerms } : { 原句: excerpt }
    )
    let responseText = ''
    for await (const event of this.stream(
      randomUUID(),
      [
        {
          role: 'user',
          content: hasRelatedTerms
            ? '请先解释整句话，再着重解释指定词语在句子里的含义。'
            : '请解释整句话的意思，并直接给出适合保存为笔记的内容。'
        }
      ],
      'excerpt',
      { sourceText, hasRelatedTerms }
    )) {
      if (event.type === 'delta') responseText += event.text
      if (event.type === 'error') throw new Error(event.message)
    }
    const note = responseText.trim()
    if (!note) throw new Error('AI 没有生成笔记内容。')
    return note
  }

  async explainOcrContext(
    requestId: string,
    input: { word: string; sentence: string; context: string }
  ): Promise<OcrAiExplanation> {
    let responseText = ''
    for await (const event of this.stream(
      requestId,
      [{ role: 'user', content: JSON.stringify(input) }],
      'ocr-context'
    )) {
      if (event.type === 'delta') responseText += event.text
      if (event.type === 'error') throw new Error(event.message)
    }
    const normalized = responseText
      .trim()
      .replace(/^```(?:json)?\s*/iu, '')
      .replace(/\s*```$/u, '')
    let value: unknown
    try {
      value = JSON.parse(normalized)
    } catch {
      throw new Error('AI 未返回有效的 JSON 解释。')
    }
    if (!value || typeof value !== 'object') throw new Error('AI 解释格式无效。')
    const explanation = value as Record<string, unknown>
    if (
      typeof explanation.sentenceMeaning !== 'string' ||
      !explanation.sentenceMeaning.trim() ||
      typeof explanation.wordMeaning !== 'string' ||
      !explanation.wordMeaning.trim() ||
      typeof explanation.usage !== 'string'
    ) {
      throw new Error('AI 解释缺少必要内容。')
    }
    return {
      sentenceMeaning: explanation.sentenceMeaning.trim(),
      wordMeaning: explanation.wordMeaning.trim(),
      usage: explanation.usage.trim()
    }
  }

  start(
    requestId: string,
    messages: AiChatMessage[],
    promptTarget: AiPromptTarget,
    onEvent: AiStreamHandler,
    lookupContext?: AiLookupContext
  ): void {
    void this.consume(requestId, messages, promptTarget, lookupContext, onEvent)
  }

  cancel(requestId: string): void {
    this.requests.get(requestId)?.abort()
    this.requests.delete(requestId)
  }

  dispose(): void {
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
  }

  private async consume(
    requestId: string,
    messages: AiChatMessage[],
    promptTarget: AiPromptTarget,
    lookupContext: AiLookupContext | undefined,
    onEvent: AiStreamHandler
  ): Promise<void> {
    for await (const event of this.stream(
      requestId,
      messages,
      promptTarget,
      lookupContext,
      onEvent
    )) {
      // The stream handler owns IPC delivery; consuming keeps the generator alive.
      void event
    }
  }
}

function validateMessages(messages: AiChatMessage[]): AiChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new Error('AI 消息数量无效。')
  }
  let totalLength = 0
  return messages.map((message) => {
    if (
      !message ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string'
    ) {
      throw new Error('AI 消息格式无效。')
    }
    const content = message.content.trim()
    if (!content || content.length > MAX_MESSAGE_LENGTH) throw new Error('AI 消息内容无效。')
    totalLength += content.length
    if (totalLength > 200_000) throw new Error('AI 对话内容过长。')
    return { role: message.role, content }
  })
}
