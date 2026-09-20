import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AuiIf,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  MessagePartPrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter
} from '@assistant-ui/react'
import type { TextMessagePartProps } from '@assistant-ui/react'
import { ArrowUp, Bot, Info, Link, Square, Sparkles, Unlink, X } from 'lucide-react'

import { AiRichText } from '@/components/AiRichText'
import { RightSidebarSizeToggle } from '@/components/RightSidebarSizeToggle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

type AiLookupThreadProps = {
  word: string
}

type AiLookupEvent = Parameters<Parameters<typeof window.dictol.aiLookup.onEvent>[0]>[0]

function createIpcChatModel(sourceText: string): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      abortSignal.throwIfAborted()
      const serializedMessages = messages.flatMap((message) => {
        const content = message.content
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .trim()
        if (!content || (message.role !== 'user' && message.role !== 'assistant')) return []
        return [{ role: message.role, content }]
      })

      let requestId: string | null = null
      let stop: (() => void) | undefined
      let removeAbortListener: (() => void) | undefined
      const deltas = new ReadableStream<string>({
        start(controller) {
          let settled = false
          const pendingEvents: AiLookupEvent[] = []
          const close = (): void => {
            if (settled) return
            settled = true
            controller.close()
          }
          const fail = (error: unknown): void => {
            if (settled) return
            settled = true
            controller.error(error)
          }
          const handleEvent = (event: AiLookupEvent): void => {
            if (!requestId) {
              if (pendingEvents.length < 32) pendingEvents.push(event)
              return
            }
            if (event.requestId !== requestId) return
            if (event.type === 'delta' && event.text) controller.enqueue(event.text)
            if (event.type === 'done') {
              unsubscribe()
              close()
            }
            if (event.type === 'error') {
              unsubscribe()
              fail(new Error(event.message ?? 'AI 请求失败。'))
            }
          }
          const unsubscribe = window.dictol.aiLookup.onEvent((event) => {
            handleEvent(event)
          })
          void window.dictol.aiLookup
            .startChat({
              messages: serializedMessages,
              promptTarget: 'sidebar',
              lookupContext: { sourceText }
            })
            .then((value) => {
              requestId = value
              if (!requestId) {
                fail(new Error('AI 请求无法启动。'))
                return
              }
              pendingEvents.splice(0).forEach((event) => handleEvent(event))
            })
            .catch(fail)
          const onAbort = (): void => {
            if (requestId) window.dictol.aiLookup.cancel(requestId)
            unsubscribe()
            fail(abortSignal.reason ?? new Error('请求已取消。'))
          }
          abortSignal.addEventListener('abort', onAbort, { once: true })
          removeAbortListener = () => abortSignal.removeEventListener('abort', onAbort)
          if (abortSignal.aborted) onAbort()
          stop = () => {
            if (requestId) window.dictol.aiLookup.cancel(requestId)
            unsubscribe()
            close()
          }
        },
        cancel() {
          stop?.()
        }
      })

      const reader = deltas.getReader()
      let fullText = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) return
          fullText += value
          yield { content: [{ type: 'text', text: fullText }] }
        }
      } finally {
        removeAbortListener?.()
        stop?.()
        reader.releaseLock()
      }
    }
  }
}

export function AiLookupSidebar(): React.JSX.Element {
  const { term } = useParams<{ term?: string }>()
  const word = useAppStore((state) => state.aiSearchTerm)
  const setAiSearchTerm = useAppStore((state) => state.setAiSearchTerm)
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen)
  const [followSearch, setFollowSearch] = useState(false)
  const normalizedTerm = term?.trim() ?? ''
  const normalizedWord = word.trim()
  const followedTermRef = useRef(normalizedTerm)

  useEffect(() => {
    if (!followSearch) return
    if (normalizedTerm === followedTermRef.current) return

    followedTermRef.current = normalizedTerm
    if (normalizedTerm && normalizedTerm !== normalizedWord) setAiSearchTerm(normalizedTerm)
  }, [followSearch, normalizedTerm, normalizedWord, setAiSearchTerm])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--ai-panel-background)]">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <Sparkles className="mr-2 size-4 text-primary" />
        <h2 className="min-w-0 flex-1 text-sm font-medium">AI 查词</h2>
        <Button
          aria-label={followSearch ? '关闭跟随查询' : '跟随查询'}
          aria-pressed={followSearch}
          className={cn(
            'mr-1 size-7 shrink-0',
            followSearch && 'bg-primary/10 text-primary hover:bg-primary/15'
          )}
          onClick={() => {
            if (!followSearch) followedTermRef.current = normalizedTerm
            setFollowSearch((value) => !value)
          }}
          size="icon"
          title={followSearch ? '关闭跟随查询' : '跟随查询'}
          type="button"
          variant="ghost"
        >
          {followSearch ? <Link /> : <Unlink />}
        </Button>
        <RightSidebarSizeToggle />
        <Button
          aria-label="关闭辅助面板"
          className="size-7 shrink-0"
          onClick={() => setRightSidebarOpen(false)}
          size="icon"
          title="关闭辅助面板"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
      {normalizedWord ? (
        <AiLookupSession key={normalizedWord} sourceText={normalizedWord} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm leading-6 text-muted-foreground">
          选择一个词条后，可以在这里询问 AI
        </div>
      )}
    </div>
  )
}

function AiLookupSession({ sourceText }: { sourceText: string }): React.JSX.Element {
  const model = useMemo(() => createIpcChatModel(sourceText), [sourceText])
  const runtime = useLocalRuntime(model)
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AiLookupThread word={sourceText} />
    </AssistantRuntimeProvider>
  )
}

function AiLookupThread({ word }: AiLookupThreadProps): React.JSX.Element {
  const aui = useAui()
  const normalizedWord = word.trim()

  useEffect(() => {
    if (!normalizedWord) return
    aui.thread().reset()
    aui.thread().append({
      role: 'user',
      content: [{ type: 'text', text: normalizedWord }],
      startRun: true
    })
  }, [aui, normalizedWord])

  const renderMessage = useCallback(
    ({ message }: { message: { role: string } }): React.JSX.Element => {
      const isUser = message.role === 'user'
      return (
        <MessagePrimitive.Root className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
          <div className={isUser ? 'max-w-[88%]' : 'max-w-[94%]'}>
            <AiMessageBubble isUser={isUser} />
            {!isUser && (
              <AuiIf condition={(state) => state.message.status?.type === 'complete'}>
                <p className="mt-1 flex items-center gap-1 px-1 text-xs leading-4 text-muted-foreground/70">
                  <Info aria-hidden="true" className="size-3 shrink-0" />
                  内容系AI生成，请注意甄别
                </p>
              </AuiIf>
            )}
          </div>
        </MessagePrimitive.Root>
      )
    },
    []
  )

  return (
    <ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col bg-[var(--ai-panel-background)]">
      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-pb-24 px-3 py-4 pb-24">
        <ThreadPrimitive.Empty>
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Bot className="size-5" />
            <span>可以继续询问这个词条</span>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages>{renderMessage}</ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>

      <ComposerPrimitive.Root className="absolute inset-x-3 bottom-3 z-10 flex flex-col rounded-[20px] border border-border/70 bg-card/90 p-1.5 shadow-lg shadow-foreground/5 backdrop-blur-md transition-[background-color,border-color,box-shadow] focus-within:border-primary/40 focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/10">
        <div className="min-w-0">
          <ComposerPrimitive.Input
            className="block min-w-full resize-none bg-transparent px-2.5 py-1.5 pr-11 text-sm leading-5 outline-none placeholder:text-muted-foreground/70"
            placeholder="继续询问…"
          />
        </div>
        <div className="absolute bottom-1.5 right-1.5 flex items-center">
          <AuiIf condition={(state) => state.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild>
              <Button
                aria-label="停止生成"
                className="size-8 shrink-0 rounded-full"
                size="icon"
                type="button"
                variant="ghost"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            </ComposerPrimitive.Cancel>
          </AuiIf>
          <AuiIf condition={(state) => !state.thread.isRunning}>
            <ComposerPrimitive.Send asChild>
              <Button
                aria-label="发送"
                className="size-8 shrink-0 rounded-full shadow-none"
                size="icon"
                type="button"
              >
                <ArrowUp className="size-4" />
              </Button>
            </ComposerPrimitive.Send>
          </AuiIf>
        </div>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  )
}

function AiMessageBubble({ isUser }: { isUser: boolean }): React.JSX.Element {
  const hasError = useAuiState(
    (state) =>
      state.message.status?.type === 'incomplete' && state.message.status.reason === 'error'
  )

  return (
    <div
      className={cn(
        'rounded-2xl border px-3 py-2 text-sm',
        isUser &&
          'rounded-br-md border-[var(--ai-user-message-border)] bg-[var(--ai-user-message-background)] text-foreground',
        !isUser &&
          (hasError
            ? 'rounded-bl-md border-destructive/25 bg-destructive/8 text-xs leading-6 text-destructive'
            : 'rounded-bl-md border-[var(--ai-assistant-message-border)] bg-[var(--ai-assistant-message-background)] text-sm leading-6')
      )}
    >
      <MessagePrimitive.Parts components={{ Text: MarkdownMessagePart }} />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root>
          <span className="font-medium">AI 请求失败：</span>
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </div>
  )
}

function MarkdownMessagePart({ text }: TextMessagePartProps): React.JSX.Element {
  const showInitialResponseIndicator = useAuiState(
    (state) =>
      state.thread.isRunning &&
      state.message.isLast &&
      state.message.role === 'assistant' &&
      state.message.status.type === 'running' &&
      state.message.content.length === 0
  )

  return (
    <>
      <AiRichText content={text} />
      {showInitialResponseIndicator ? (
        <MessagePartPrimitive.InProgress>
          <AiWaitingIndicator />
        </MessagePartPrimitive.InProgress>
      ) : null}
    </>
  )
}

function AiWaitingIndicator(): React.JSX.Element {
  const animationId = useId().replaceAll(':', '')
  const startId = `ai-waiting-dot-start-${animationId}`
  const endId = `ai-waiting-dot-end-${animationId}`

  return (
    <svg
      aria-label="正在等待响应"
      className="ml-1 inline-block size-4 text-primary/65"
      fill="none"
      role="img"
      viewBox="0 0 24 24"
    >
      <circle cx="4" cy="12" r="3" fill="currentColor">
        <animate
          id={startId}
          attributeName="r"
          begin={`0;${endId}.end-0.25s`}
          dur="0.75s"
          repeatCount="indefinite"
          values="3;.2;3"
        />
      </circle>
      <circle cx="12" cy="12" r="3" fill="currentColor">
        <animate
          attributeName="r"
          begin={`${startId}.end-0.6s`}
          dur="0.75s"
          repeatCount="indefinite"
          values="3;.2;3"
        />
      </circle>
      <circle cx="20" cy="12" r="3" fill="currentColor">
        <animate
          id={endId}
          attributeName="r"
          begin={`${startId}.end-0.45s`}
          dur="0.75s"
          repeatCount="indefinite"
          values="3;.2;3"
        />
      </circle>
    </svg>
  )
}
