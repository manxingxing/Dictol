import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Check, Copy, Languages, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGE_NAMES,
  TRANSLATION_MAX_TEXT_LENGTH,
  type TranslationEvent,
  type TranslationLanguage,
  type TranslationPublicConfig,
  type TranslationSourceLanguage
} from '../../../shared/translation'

type Status = 'idle' | 'running' | 'ready' | 'error'

export function TranslationPage(): React.JSX.Element {
  const api = window.dictol.translation
  const [config, setConfig] = useState<TranslationPublicConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [providerId, setProviderId] = useState('')
  const [sourceLanguage, setSourceLanguage] = useState<TranslationSourceLanguage>('auto')
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguage>('zh')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [detectedSourceLanguage, setDetectedSourceLanguage] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const requestIdRef = useRef<string | null>(null)
  const requestVersionRef = useRef(0)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let active = true
    void api
      .getConfig()
      .then((value) => {
        if (!active) return
        setConfig(value)
        setTargetLanguage(value?.targetLanguage ?? 'zh')
        setProviderId(value?.providers.find((provider) => provider.available)?.id ?? '')
        setLoadingConfig(false)
      })
      .catch((loadError) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : '无法读取翻译设置。')
        setLoadingConfig(false)
      })
    return () => {
      active = false
    }
  }, [api])

  useEffect(() => {
    return () => {
      requestVersionRef.current += 1
      if (requestIdRef.current) api.cancel(requestIdRef.current)
      unsubscribeRef.current?.()
    }
  }, [api])

  const availableProviders = config?.providers.filter((provider) => provider.available) ?? []

  const translate = useCallback(
    async (
      text: string,
      selectedProviderId: string,
      source: TranslationSourceLanguage,
      target: TranslationLanguage
    ): Promise<void> => {
      const content = text.trim()
      const version = ++requestVersionRef.current
      if (requestIdRef.current) api.cancel(requestIdRef.current)
      requestIdRef.current = null
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
      setOutput('')
      setDetectedSourceLanguage('')
      setError('')
      if (!content || !selectedProviderId) {
        setStatus('idle')
        return
      }
      if (content.length > TRANSLATION_MAX_TEXT_LENGTH) {
        setError(`翻译文本最多 ${TRANSLATION_MAX_TEXT_LENGTH} 个字符。`)
        setStatus('error')
        return
      }
      if (source === target) {
        setError('源语言和目标语言不能相同。')
        setStatus('error')
        return
      }
      setStatus('running')
      setCopied(false)
      let startedId: string | null = null
      const pendingEvents: TranslationEvent[] = []
      const handleEvent = (event: TranslationEvent): void => {
        if (version !== requestVersionRef.current) return
        if (!startedId) {
          pendingEvents.push(event)
          return
        }
        if (event.requestId !== startedId) return
        if (event.type === 'delta') setOutput((current) => current + event.text)
        if (event.type === 'done') {
          setDetectedSourceLanguage(event.detectedSourceLanguage ?? '')
          setStatus('ready')
          unsubscribeRef.current?.()
          unsubscribeRef.current = null
          requestIdRef.current = null
        }
        if (event.type === 'error') {
          setError(event.message)
          setStatus('error')
          unsubscribeRef.current?.()
          unsubscribeRef.current = null
          requestIdRef.current = null
        }
      }
      unsubscribeRef.current = api.onEvent(handleEvent)
      try {
        startedId = await api.start({
          providerId: selectedProviderId,
          text: content,
          sourceLanguage: source,
          targetLanguage: target
        })
        if (version !== requestVersionRef.current) {
          if (startedId) api.cancel(startedId)
          return
        }
        if (!startedId) throw new Error('翻译请求无法启动。')
        requestIdRef.current = startedId
        pendingEvents.splice(0).forEach(handleEvent)
      } catch (requestError) {
        if (version !== requestVersionRef.current) return
        setError(requestError instanceof Error ? requestError.message : '翻译失败。')
        setStatus('error')
        unsubscribeRef.current?.()
        unsubscribeRef.current = null
      }
    },
    [api]
  )

  const copyResult = async (): Promise<void> => {
    if (!output) return
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const changeInput = (value: string): void => {
    requestVersionRef.current += 1
    if (requestIdRef.current) api.cancel(requestIdRef.current)
    requestIdRef.current = null
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    setInput(value)
    setOutput('')
    setError('')
    setStatus('idle')
  }

  if (loadingConfig) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        正在读取翻译设置…
      </div>
    )
  }

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col p-6 sm:p-8">
      <header className="shrink-0">
        <p className="mb-2 text-sm font-medium text-primary">翻译</p>
        <h1 className="text-xl font-semibold tracking-tight">翻译文本</h1>
      </header>
      <div className="mt-8 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex shrink-0 items-end gap-2 border-b border-border p-3">
            <label className="min-w-0 flex-1 space-y-1 text-xs">
              <span>源语言</span>
              <select
                aria-label="源语言"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={sourceLanguage}
                onChange={(event) => {
                  const source = event.target.value as TranslationSourceLanguage
                  setSourceLanguage(source)
                  if (input.trim()) void translate(input, providerId, source, targetLanguage)
                }}
              >
                <option value="auto">自动检测</option>
                {TRANSLATION_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {TRANSLATION_LANGUAGE_NAMES[language]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              aria-label="互换翻译语言"
              disabled={sourceLanguage === 'auto'}
              onClick={() => {
                if (sourceLanguage === 'auto') return
                const nextSource = targetLanguage
                const nextTarget = sourceLanguage
                setSourceLanguage(nextSource)
                setTargetLanguage(nextTarget)
                if (input.trim()) void translate(input, providerId, nextSource, nextTarget)
              }}
              size="icon"
              variant="ghost"
            >
              <ArrowLeftRight />
            </Button>
            <label className="min-w-0 flex-1 space-y-1 text-xs">
              <span>目标语言</span>
              <select
                aria-label="目标语言"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={targetLanguage}
                onChange={(event) => {
                  const target = event.target.value as TranslationLanguage
                  setTargetLanguage(target)
                  if (input.trim()) void translate(input, providerId, sourceLanguage, target)
                }}
              >
                {TRANSLATION_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {TRANSLATION_LANGUAGE_NAMES[language]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea
            aria-label="待翻译文本"
            className="min-h-0 flex-1 resize-none border-0 bg-transparent p-4 text-sm leading-6 outline-none"
            maxLength={TRANSLATION_MAX_TEXT_LENGTH}
            onChange={(event) => changeInput(event.target.value)}
            placeholder="输入要翻译的文本…"
            value={input}
          />
          <div className="flex justify-end p-3">
            <Button
              disabled={!input.trim() || !providerId || status === 'running'}
              onClick={() => void translate(input, providerId, sourceLanguage, targetLanguage)}
            >
              {status === 'running' ? <LoaderCircle className="animate-spin" /> : <Languages />}
              {status === 'running' ? '翻译中…' : '翻译'}
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex shrink-0 items-center gap-2 border-b border-border p-3">
            <label className="min-w-0 flex-1 text-xs">
              <span className="sr-only">翻译服务</span>
              <select
                aria-label="翻译服务"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                disabled={!availableProviders.length}
                value={providerId}
                onChange={(event) => {
                  const id = event.target.value
                  setProviderId(id)
                  if (input.trim()) void translate(input, id, sourceLanguage, targetLanguage)
                }}
              >
                {!availableProviders.length && <option value="">尚无可用翻译服务</option>}
                {availableProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              aria-label="复制译文"
              disabled={status !== 'ready' || !output}
              onClick={() => void copyResult()}
              size="icon"
              variant="ghost"
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap p-4 text-sm leading-6">
            {output ||
              (status === 'running'
                ? '正在翻译…'
                : availableProviders.length
                  ? '译文会显示在这里'
                  : '请先在设置中添加并启用翻译服务。')}
          </div>
          {error && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
              <span>{error}</span>
              <Button
                disabled={!providerId}
                onClick={() => void translate(input, providerId, sourceLanguage, targetLanguage)}
                size="sm"
                variant="outline"
              >
                重试
              </Button>
            </div>
          )}
          {status === 'ready' && detectedSourceLanguage && (
            <div className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
              检测到源语言：{detectedSourceLanguage}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
