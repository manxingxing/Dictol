import { randomUUID } from 'node:crypto'
import type { AppConfigStore } from '../app-config'
import {
  SYSTEM_TRANSLATION_PROVIDER_ID,
  TRANSLATION_LANGUAGES,
  TRANSLATION_MAX_TEXT_LENGTH,
  type TranslationEvent,
  type TranslationLanguage,
  type TranslationProviderConfig,
  type TranslationPublicConfig,
  type TranslationRequest,
  type TranslationSaveProviderRequest
} from '../../shared/translation'
import { TranslationCredentialStore } from './credentials'
import { adapters } from './providers'
import { isSystemTranslationAvailable } from './system'

const REQUEST_TIMEOUT_MS = 120_000
const SYSTEM_REQUEST_TIMEOUT_MS = 600_000

export class TranslationService {
  private readonly credentials = new TranslationCredentialStore()
  private readonly requests = new Map<string, AbortController>()

  constructor(private readonly appConfig: AppConfigStore) {}

  getConfig(): TranslationPublicConfig {
    const config = this.appConfig.load()
    return {
      targetLanguage: config.translation.targetLanguage,
      providers: config.translation.providers.map((provider) => {
        const credentials = this.credentials.get(provider.id)
        return {
          ...provider,
          options: { ...provider.options },
          hasCredentials: Boolean(credentials.apiKey || credentials.accessKeyId),
          available: provider.enabled && this.isReady(provider, credentials)
        }
      })
    }
  }

  saveProvider(input: TranslationSaveProviderRequest): TranslationPublicConfig {
    validateProvider(input)
    const config = this.appConfig.load()
    const providers = [...config.translation.providers]
    const index = providers.findIndex((provider) => provider.id === input.id)
    if (
      index < 0 &&
      input.kind !== 'system' &&
      providers.filter((provider) => provider.kind !== 'system').length >= 20
    ) {
      throw new Error('最多添加 20 个自定义翻译服务。')
    }
    if (index >= 0 && providers[index].kind !== input.kind) {
      throw new Error('不能改变现有服务的类型。')
    }
    const provider: TranslationProviderConfig = {
      id: input.id,
      kind: input.kind,
      name: input.kind === 'system' ? '系统翻译' : input.name.trim(),
      enabled: input.enabled,
      options: input.kind === 'system' ? {} : normalizeOptions(input.kind, input.options)
    }
    if (input.kind !== 'system' && input.credentials && Object.keys(input.credentials).length > 0) {
      const credentials = Object.fromEntries(
        Object.entries(input.credentials)
          .filter(
            ([key, value]) =>
              ['apiKey', 'accessKeyId', 'secretAccessKey'].includes(key) &&
              typeof value === 'string' &&
              value.trim().length > 0
          )
          .map(([key, value]) => [key, value.trim()])
      )
      if (Object.keys(credentials).length > 0) this.credentials.save(input.id, credentials)
    }
    if (index >= 0) providers[index] = provider
    else providers.push(provider)
    this.appConfig.save({
      ...config,
      translation: { ...config.translation, providers }
    })
    return this.getConfig()
  }

  removeProvider(id: string): TranslationPublicConfig {
    if (id === SYSTEM_TRANSLATION_PROVIDER_ID) {
      throw new Error('内置翻译服务不能删除，可以在翻译服务中关闭。')
    }
    const config = this.appConfig.load()
    const providers = config.translation.providers.filter((provider) => provider.id !== id)
    this.appConfig.save({ ...config, translation: { ...config.translation, providers } })
    this.credentials.delete(id)
    return this.getConfig()
  }

  reorderProviders(order: string[]): TranslationPublicConfig {
    const config = this.appConfig.load()
    const current = config.translation.providers
    const providerById = new Map(current.map((provider) => [provider.id, provider]))
    if (
      !Array.isArray(order) ||
      order.length !== current.length ||
      new Set(order).size !== current.length ||
      !order.every((id) => typeof id === 'string' && providerById.has(id))
    ) {
      throw new Error('无效的翻译服务顺序。')
    }
    if (current.every((provider, index) => provider.id === order[index])) return this.getConfig()
    const providers = order.map((id) => providerById.get(id)!)
    this.appConfig.save({ ...config, translation: { ...config.translation, providers } })
    return this.getConfig()
  }

  setTargetLanguage(targetLanguage: TranslationLanguage): TranslationPublicConfig {
    if (!TRANSLATION_LANGUAGES.includes(targetLanguage)) throw new Error('不支持的目标语言。')
    const config = this.appConfig.load()
    this.appConfig.save({
      ...config,
      translation: { ...config.translation, targetLanguage }
    })
    return this.getConfig()
  }

  start(request: TranslationRequest, onEvent: (event: TranslationEvent) => void): string {
    validateRequest(request)
    const requestId = randomUUID()
    const controller = new AbortController()
    this.requests.set(requestId, controller)
    queueMicrotask(() => void this.run(requestId, request, controller, onEvent))
    return requestId
  }

  async testProvider(id: string): Promise<void> {
    const config = this.appConfig.load()
    const provider = config.translation.providers.find((item) => item.id === id)
    if (!provider) throw new Error('翻译服务不存在。')
    const credentials = this.credentials.get(provider.id)
    if (!this.isReady(provider, credentials)) throw new Error('请先完成服务配置。')
    const targetLanguage = provider.kind === 'system' ? config.translation.targetLanguage : 'zh'
    const sourceLanguage = targetLanguage === 'en' ? 'zh' : 'en'
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      provider.kind === 'system' ? SYSTEM_REQUEST_TIMEOUT_MS : 15_000
    )
    try {
      await adapters[provider.kind]({
        config: provider,
        credentials,
        request: {
          providerId: id,
          text: sourceLanguage === 'zh' ? '你好' : 'Hello',
          sourceLanguage,
          targetLanguage
        },
        signal: controller.signal,
        onDelta: () => undefined
      })
    } catch (error) {
      if (controller.signal.aborted) throw new Error('验证超时，请重试。')
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  cancel(requestId: string): void {
    this.requests.get(requestId)?.abort()
    this.requests.delete(requestId)
  }

  dispose(): void {
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
  }

  private async run(
    requestId: string,
    request: TranslationRequest,
    controller: AbortController,
    onEvent: (event: TranslationEvent) => void
  ): Promise<void> {
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const provider = this.appConfig
        .load()
        .translation.providers.find((item) => item.id === request.providerId)
      if (!provider || !provider.enabled) throw new Error('翻译服务未启用。')
      timeout = setTimeout(
        () => {
          timedOut = true
          controller.abort()
        },
        provider.kind === 'system' ? SYSTEM_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS
      )
      const credentials = this.credentials.get(provider.id)
      if (!this.isReady(provider, credentials)) throw new Error('请先完成翻译服务配置。')
      let streamed = false
      const result = await adapters[provider.kind]({
        config: provider,
        credentials,
        request,
        signal: controller.signal,
        onDelta: (text) => {
          streamed = true
          if (!controller.signal.aborted) onEvent({ requestId, type: 'delta', text })
        }
      })
      if (controller.signal.aborted) return
      if (!streamed) onEvent({ requestId, type: 'delta', text: result.text })
      onEvent({ requestId, type: 'done', detectedSourceLanguage: result.detectedSourceLanguage })
    } catch (error) {
      if (timedOut) {
        onEvent({ requestId, type: 'error', message: '翻译超时，请重试。' })
      } else if (!controller.signal.aborted) {
        onEvent({
          requestId,
          type: 'error',
          message: error instanceof Error ? error.message : '翻译失败。'
        })
      }
    } finally {
      if (timeout) clearTimeout(timeout)
      this.requests.delete(requestId)
    }
  }

  private isReady(
    provider: TranslationProviderConfig,
    credentials: Record<string, string>
  ): boolean {
    const options = provider.options
    switch (provider.kind) {
      case 'openai-compatible':
        return Boolean(options.baseUrl && options.model)
      case 'system':
        return isSystemTranslationAvailable()
      case 'volcano':
        return Boolean(credentials.accessKeyId && credentials.secretAccessKey)
      case 'google':
      case 'microsoft':
      case 'deepl':
        return Boolean(credentials.apiKey)
    }
  }
}

function validateProvider(value: TranslationSaveProviderRequest): void {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string') {
    throw new Error('翻译服务设置无效。')
  }
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(value.id)) throw new Error('翻译服务 ID 无效。')
  if (!Object.hasOwn(adapters, value.kind)) throw new Error('不支持的翻译服务。')
  if (value.id === SYSTEM_TRANSLATION_PROVIDER_ID && value.kind !== 'system') {
    throw new Error('翻译服务 ID 无效。')
  }
  if (value.kind === 'system' && value.id !== SYSTEM_TRANSLATION_PROVIDER_ID) {
    throw new Error('系统翻译不能重复添加。')
  }
  if (value.kind === 'system' && process.platform !== 'darwin') {
    throw new Error('系统翻译仅支持 macOS。')
  }
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) {
    throw new Error('请填写服务名称。')
  }
  if (typeof value.enabled !== 'boolean' || !value.options || typeof value.options !== 'object') {
    throw new Error('翻译服务设置无效。')
  }
  if (value.kind === 'openai-compatible') {
    if (!value.options.model?.trim() || !value.options.baseUrl?.trim()) {
      throw new Error('请填写服务地址和模型。')
    }
    const url = new URL(value.options.baseUrl)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('服务地址必须使用 HTTP(S)。')
  }
  if (value.kind === 'microsoft' && value.options.endpoint) {
    const url = new URL(value.options.endpoint)
    if (url.protocol !== 'https:') throw new Error('Microsoft 服务地址必须使用 HTTPS。')
  }
  if (value.kind === 'deepl' && !['free', 'pro'].includes(value.options.plan)) {
    throw new Error('请选择 DeepL 套餐。')
  }
}

function normalizeOptions(
  kind: TranslationProviderConfig['kind'],
  value: Record<string, string>
): Record<string, string> {
  const allowed: Record<TranslationProviderConfig['kind'], string[]> = {
    system: [],
    google: [],
    microsoft: ['region', 'endpoint'],
    volcano: [],
    deepl: ['plan'],
    'openai-compatible': ['baseUrl', 'model']
  }
  const options: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (allowed[kind].includes(key) && typeof item === 'string' && item.length <= 500) {
      options[key] = item.trim()
    }
  }
  return options
}

function validateRequest(request: TranslationRequest): void {
  if (
    !request ||
    typeof request.providerId !== 'string' ||
    typeof request.text !== 'string' ||
    !request.text.trim() ||
    request.text.length > TRANSLATION_MAX_TEXT_LENGTH ||
    !TRANSLATION_LANGUAGES.includes(request.targetLanguage) ||
    (request.sourceLanguage !== 'auto' &&
      !TRANSLATION_LANGUAGES.includes(request.sourceLanguage)) ||
    request.sourceLanguage === request.targetLanguage
  ) {
    throw new Error('翻译文本或语言设置无效。')
  }
}
