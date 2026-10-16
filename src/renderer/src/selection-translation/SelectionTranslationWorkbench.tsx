import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Languages,
  LoaderCircle,
  Pin,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGE_NAMES,
  TRANSLATION_MAX_TEXT_LENGTH,
  type SelectionTranslationPayload,
  type TranslationApi,
  type TranslationEvent,
  type TranslationLanguage,
  type TranslationPublicConfig,
  type TranslationPublicProvider,
  type TranslationSourceLanguage
} from '../../../shared/translation'

type TranslationBatch = {
  version: number
  text: string
  sourceLanguage: TranslationSourceLanguage
  targetLanguage: TranslationLanguage
}

type Props = {
  api: TranslationApi
  selection?: SelectionTranslationPayload
  onClose: () => void
  onTogglePin: () => Promise<boolean>
  setDesiredHeight: (version: number, height: number) => void
}

export function SelectionTranslationWorkbench({
  api,
  selection,
  onClose,
  onTogglePin,
  setDesiredHeight
}: Props): React.JSX.Element {
  const [config, setConfig] = useState<TranslationPublicConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sourceLanguage, setSourceLanguage] = useState<TranslationSourceLanguage>('auto')
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguage>('zh')
  const [sourceCollapsed, setSourceCollapsed] = useState(true)
  const [pinned, setPinned] = useState(selection?.pinned ?? false)
  const [batch, setBatch] = useState<TranslationBatch | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState('')
  const batchVersionRef = useRef(0)
  const headerRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const providers = config?.providers.filter((provider) => provider.available) ?? []

  const translateAll = useCallback(
    (
      text: string,
      source: TranslationSourceLanguage,
      target: TranslationLanguage,
      availableProviders: TranslationPublicProvider[]
    ): void => {
      const content = text.trim()
      setError('')
      if (!content || availableProviders.length === 0) {
        setBatch(null)
        setPendingCount(0)
        return
      }
      if (content.length > TRANSLATION_MAX_TEXT_LENGTH || source === target) {
        setBatch(null)
        setPendingCount(0)
        setError(
          source === target
            ? '源语言和目标语言不能相同。'
            : `翻译文本最多 ${TRANSLATION_MAX_TEXT_LENGTH} 个字符。`
        )
        return
      }
      const version = ++batchVersionRef.current
      setPendingCount(availableProviders.length)
      setBatch({ version, text: content, sourceLanguage: source, targetLanguage: target })
    },
    []
  )

  useEffect(() => {
    if (!selection) return
    let active = true
    void api
      .getConfig()
      .then((value) => {
        if (!active) return
        const target = value?.targetLanguage ?? 'zh'
        setConfig(value)
        setInput(selection.text)
        setSourceLanguage('auto')
        setTargetLanguage(target)
        setLoading(false)
        translateAll(
          selection.text,
          'auto',
          target,
          value?.providers.filter((provider) => provider.available) ?? []
        )
      })
      .catch((cause) => {
        if (!active) return
        setLoading(false)
        setError(cause instanceof Error ? cause.message : '无法读取翻译设置。')
      })
    return () => {
      active = false
    }
  }, [api, selection, translateAll])

  useEffect(() => {
    if (!selection || !headerRef.current || !contentRef.current) return
    const header = headerRef.current
    const content = contentRef.current
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setDesiredHeight(
          selection.version,
          Math.ceil(header.offsetHeight + content.scrollHeight + 16)
        )
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    observer.observe(content)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [selection, setDesiredHeight])

  const settle = useCallback((version: number): void => {
    if (version !== batchVersionRef.current) return
    setPendingCount((count) => Math.max(0, count - 1))
  }, [])

  const submitTranslation = (
    source: TranslationSourceLanguage,
    target: TranslationLanguage
  ): void => {
    if (!input.trim() || !providers.length) return
    translateAll(input, source, target, providers)
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header
        className="drag-region flex shrink-0 items-center justify-between border-b border-border px-2.5 py-1"
        ref={headerRef}
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Languages className="size-3.5" />
          划词翻译
        </div>
        <div className="flex items-center gap-1">
          <Button
            aria-label={pinned ? '取消置顶' : '置顶窗口'}
            aria-pressed={pinned}
            className={`no-drag size-7 p-0 ${pinned ? 'text-primary' : ''}`}
            onClick={() => void onTogglePin().then(setPinned)}
            size="xs"
            title={pinned ? '取消置顶' : '置顶窗口'}
            variant="ghost"
          >
            <Pin fill={pinned ? 'currentColor' : 'none'} />
          </Button>
          <Button
            aria-label="关闭翻译窗口"
            className="no-drag size-7 p-0"
            onClick={onClose}
            size="xs"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
      </header>
      <div className="selection-translation-results min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-1.5" ref={contentRef}>
          {loading ? (
            <p className="py-4 text-center text-xs text-muted-foreground">正在读取翻译设置…</p>
          ) : (
            <>
              <section className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span>源语言</span>
                    <select
                      aria-label="源语言"
                      className="h-6 w-[88px] rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      onChange={(event) => {
                        const source = event.target.value as TranslationSourceLanguage
                        setSourceLanguage(source)
                        submitTranslation(source, targetLanguage)
                      }}
                      value={sourceLanguage}
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
                    className="size-7 shrink-0 p-0"
                    disabled={sourceLanguage === 'auto'}
                    onClick={() => {
                      if (sourceLanguage === 'auto') return
                      setSourceLanguage(targetLanguage)
                      setTargetLanguage(sourceLanguage)
                      if (sourceLanguage !== targetLanguage) {
                        submitTranslation(targetLanguage, sourceLanguage)
                      }
                    }}
                    size="xs"
                    variant="ghost"
                  >
                    <ArrowLeftRight />
                  </Button>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span>目标语言</span>
                    <select
                      aria-label="目标语言"
                      className="h-6 w-[72px] rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      onChange={(event) => {
                        const target = event.target.value as TranslationLanguage
                        setTargetLanguage(target)
                        submitTranslation(sourceLanguage, target)
                      }}
                      value={targetLanguage}
                    >
                      {TRANSLATION_LANGUAGES.map((language) => (
                        <option key={language} value={language}>
                          {TRANSLATION_LANGUAGE_NAMES[language]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    aria-label={sourceCollapsed ? '展开原文' : '折叠原文'}
                    aria-expanded={!sourceCollapsed}
                    className="ml-auto size-7 shrink-0 p-0"
                    onClick={() => setSourceCollapsed((collapsed) => !collapsed)}
                    size="xs"
                    title={sourceCollapsed ? '展开原文' : '折叠原文'}
                    variant="ghost"
                  >
                    {sourceCollapsed ? <ChevronDown /> : <ChevronUp />}
                  </Button>
                </div>
                {!sourceCollapsed && (
                  <div>
                    <textarea
                      aria-label="待翻译文本"
                      className="selection-translation-input block w-full resize-none overflow-y-auto border-0 bg-transparent px-2 pt-2 pb-0 text-sm leading-5 shadow-none outline-none ring-0 focus:border-0 focus:outline-none focus-visible:outline-none focus:ring-0"
                      maxLength={TRANSLATION_MAX_TEXT_LENGTH}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="输入要翻译的文本…"
                      rows={2}
                      value={input}
                    />
                    <div className="flex justify-end px-2 pb-1.5">
                      <Button
                        disabled={!input.trim() || !providers.length || pendingCount > 0}
                        onClick={() => submitTranslation(sourceLanguage, targetLanguage)}
                        size="xs"
                      >
                        {pendingCount > 0 ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Languages />
                        )}
                        {pendingCount > 0 ? '翻译中…' : '翻译'}
                      </Button>
                    </div>
                  </div>
                )}
              </section>
              {error && (
                <p className="px-1 text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
              {!providers.length ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  请先在设置中添加并启用翻译服务。
                </p>
              ) : batch ? (
                providers.map((provider) => (
                  <ProviderResult
                    api={api}
                    batch={batch}
                    key={`${batch.version}:${provider.id}`}
                    onSettled={settle}
                    provider={provider}
                  />
                ))
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function ProviderResult({
  api,
  batch,
  provider,
  onSettled
}: {
  api: TranslationApi
  batch: TranslationBatch
  provider: TranslationPublicProvider
  onSettled: (version: number) => void
}): React.JSX.Element {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'running' | 'ready' | 'error'>('running')
  const [error, setError] = useState('')
  const [detectedLanguage, setDetectedLanguage] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    let requestId: string | null = null
    let settled = false
    const pendingEvents: TranslationEvent[] = []
    const handleEvent = (event: TranslationEvent): void => {
      if (!active || settled) return
      if (!requestId) {
        pendingEvents.push(event)
        return
      }
      if (event.requestId !== requestId) return
      if (event.type === 'delta') setOutput((current) => current + event.text)
      if (event.type === 'done') {
        settled = true
        setDetectedLanguage(event.detectedSourceLanguage ?? '')
        setStatus('ready')
        unsubscribe()
        onSettled(batch.version)
      }
      if (event.type === 'error') {
        settled = true
        setError(event.message)
        setStatus('error')
        unsubscribe()
        onSettled(batch.version)
      }
    }
    const unsubscribe = api.onEvent(handleEvent)
    void api
      .start({
        providerId: provider.id,
        text: batch.text,
        sourceLanguage: batch.sourceLanguage,
        targetLanguage: batch.targetLanguage
      })
      .then((id) => {
        if (!active) {
          if (id) api.cancel(id)
          return
        }
        if (!id) throw new Error('翻译请求无法启动。')
        requestId = id
        pendingEvents.splice(0).forEach(handleEvent)
      })
      .catch((cause) => {
        if (!active || settled) return
        settled = true
        setError(cause instanceof Error ? cause.message : '翻译失败。')
        setStatus('error')
        unsubscribe()
        onSettled(batch.version)
      })
    return () => {
      active = false
      if (requestId && !settled) api.cancel(requestId)
      unsubscribe()
    }
  }, [api, batch, provider.id, onSettled])

  const copyResult = async (): Promise<void> => {
    if (!output) return
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-2 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium">{provider.name}</span>
          {detectedLanguage && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              检测到 {detectedLanguage}
            </span>
          )}
        </div>
        <Button
          aria-label={`复制${provider.name}译文`}
          className="size-7 shrink-0 p-0"
          disabled={status !== 'ready' || !output}
          onClick={() => void copyResult()}
          size="xs"
          variant="ghost"
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </header>
      <div className="whitespace-pre-wrap break-words px-2 py-1.5 text-sm leading-5">
        {output ||
          (status === 'running' ? <span className="text-muted-foreground">正在翻译…</span> : null)}
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
