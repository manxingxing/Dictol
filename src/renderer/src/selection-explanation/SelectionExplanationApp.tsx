import { useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle, Star, Volume2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { AiRichText } from '@/components/AiRichText'
import { DictionaryTabIcon } from '@/components/DictionaryIcon'
import { useChromeTone } from '@/hooks/use-chrome-tone'
import {
  SELECTION_EXPLANATION_DICTIONARY_TAB_BAR_HEIGHT,
  SELECTION_EXPLANATION_DICTIONARY_SWITCHER_HEIGHT,
  SELECTION_EXPLANATION_HEADER_HEIGHT,
  type SelectionExplanationPayload
} from '../../../shared/selection-explanation'

declare global {
  interface Window {
    dictolSelectionExplanation: {
      onUpdate: (callback: (payload: SelectionExplanationPayload) => void) => () => void
      loadingReady: (requestId: number) => void
      selectDictionary: (dictionaryId: string) => void
      close: () => void
      openInMain: () => void
      readAloud: (text: string, voice?: string) => Promise<Uint8Array | null>
      isStarred: (word: string) => Promise<boolean>
      toggleStar: (word: string) => Promise<void>
    }
  }
}

const initialPayload: SelectionExplanationPayload = {
  mode: 'dictionary',
  requestId: 0,
  word: '',
  state: 'loading'
}

export function SelectionExplanationApp(): React.JSX.Element {
  useChromeTone()

  const [payload, setPayload] = useState(initialPayload)
  const [starStatus, setStarStatus] = useState<{ key: string; starred: boolean } | undefined>()
  const [togglingStar, setTogglingStar] = useState(false)
  const [pronunciationStatus, setPronunciationStatus] = useState<{
    word: string
    state: 'loading' | 'playing'
  } | null>(null)
  const pronunciationContextRef = useRef<AudioContext | null>(null)
  const pronunciationSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const pronunciationRequestRef = useRef(0)

  const wordKey = payload.word.trim()
  const starStatusReady = Boolean(wordKey) && starStatus?.key === wordKey
  const isStarred = starStatusReady && starStatus.starred
  const showStar = payload.mode === 'dictionary' && (payload.state === 'content' || starStatusReady)
  const dictionaries = payload.mode === 'dictionary' ? (payload.dictionaries ?? []) : []
  const hasDictionarySwitcher = dictionaries.length > 1
  const pronunciationState =
    pronunciationStatus?.word === wordKey ? pronunciationStatus.state : 'idle'

  useEffect(() => window.dictolSelectionExplanation.onUpdate(setPayload), [])
  useEffect(() => {
    pronunciationRequestRef.current += 1
    pronunciationSourceRef.current?.stop()
    pronunciationSourceRef.current = null
    void pronunciationContextRef.current?.close()
    pronunciationContextRef.current = null
  }, [payload.word])
  useEffect(
    () => () => {
      pronunciationRequestRef.current += 1
      try {
        pronunciationSourceRef.current?.stop()
      } catch {
        // The source may already have ended.
      }
      pronunciationSourceRef.current = null
      void pronunciationContextRef.current?.close()
      pronunciationContextRef.current = null
    },
    []
  )
  useEffect(() => {
    if (
      payload.mode !== 'dictionary' ||
      payload.state !== 'content' ||
      !payload.word ||
      starStatusReady
    ) {
      return
    }
    let active = true
    void window.dictolSelectionExplanation
      .isStarred(payload.word)
      .then((starred) => {
        if (active) setStarStatus({ key: wordKey, starred })
      })
      .catch((error: unknown) => {
        console.error('Failed to query word star status', error)
      })
    return () => {
      active = false
    }
  }, [payload.mode, payload.state, payload.word, starStatusReady, wordKey])
  useEffect(() => {
    if (payload.mode !== 'dictionary' || payload.state !== 'loading' || payload.requestId === 0)
      return
    window.dictolSelectionExplanation.loadingReady(payload.requestId)
  }, [payload.mode, payload.requestId, payload.state])
  const toggleStar = async (): Promise<void> => {
    if (
      payload.mode !== 'dictionary' ||
      payload.state !== 'content' ||
      !starStatusReady ||
      togglingStar
    ) {
      return
    }
    const nextStarred = !starStatus.starred
    setTogglingStar(true)
    try {
      await window.dictolSelectionExplanation.toggleStar(payload.word)
      setStarStatus({ key: wordKey, starred: nextStarred })
    } catch (error) {
      console.error('Failed to toggle word star status', error)
    } finally {
      setTogglingStar(false)
    }
  }

  const playPronunciation = async (): Promise<void> => {
    if (!wordKey) return
    if (pronunciationState !== 'idle') {
      pronunciationRequestRef.current += 1
      try {
        pronunciationSourceRef.current?.stop()
      } catch {
        // The source may already have ended.
      }
      pronunciationSourceRef.current = null
      void pronunciationContextRef.current?.close()
      pronunciationContextRef.current = null
      setPronunciationStatus(null)
      return
    }

    const requestId = pronunciationRequestRef.current + 1
    pronunciationRequestRef.current = requestId
    setPronunciationStatus({ word: wordKey, state: 'loading' })
    // Resume synchronously from the click handler so Chromium keeps the user
    // activation while Edge TTS is fetching the audio bytes.
    const audioContext = new AudioContext()
    pronunciationContextRef.current = audioContext
    void audioContext.resume()
    try {
      const audioData = await window.dictolSelectionExplanation.readAloud(wordKey)
      if (requestId !== pronunciationRequestRef.current || !audioData?.byteLength) return

      const audioBuffer = new Uint8Array(audioData.byteLength)
      audioBuffer.set(audioData)
      const decodedAudio = await audioContext.decodeAudioData(audioBuffer.buffer)
      if (requestId !== pronunciationRequestRef.current) return

      const source = audioContext.createBufferSource()
      source.buffer = decodedAudio
      source.connect(audioContext.destination)
      pronunciationSourceRef.current = source
      source.onended = () => {
        if (requestId !== pronunciationRequestRef.current) return
        pronunciationSourceRef.current = null
        pronunciationContextRef.current = null
        void audioContext.close()
        setPronunciationStatus(null)
      }
      source.start()
      if (requestId === pronunciationRequestRef.current) {
        setPronunciationStatus({ word: wordKey, state: 'playing' })
      }
    } catch (error) {
      if (requestId === pronunciationRequestRef.current) {
        console.error('Failed to play pronunciation', error)
        pronunciationSourceRef.current = null
        pronunciationContextRef.current = null
        void audioContext.close()
        setPronunciationStatus(null)
      }
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-xl">
      <header
        className="drag-region flex shrink-0 items-center gap-3 border-b border-border bg-sidebar px-3"
        style={{ height: SELECTION_EXPLANATION_HEADER_HEIGHT }}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {payload.mode === 'ai' ? 'AI 查词' : payload.word || '词典解释'}
          </p>
          {payload.mode === 'ai' ? (
            <p className="truncate text-[11px] text-muted-foreground">{payload.word}</p>
          ) : payload.dictionaryName && !hasDictionarySwitcher ? (
            <p className="truncate text-[11px] text-muted-foreground">{payload.dictionaryName}</p>
          ) : null}
        </div>
        {payload.mode === 'dictionary' && (
          <>
            <Button
              aria-label={pronunciationState === 'playing' ? '停止发音' : '发音'}
              className="no-drag size-7 shrink-0"
              disabled={payload.state !== 'content' || !wordKey}
              onClick={() => void playPronunciation()}
              size="icon"
              title={pronunciationState === 'playing' ? '停止发音' : '发音'}
              type="button"
              variant="ghost"
            >
              {pronunciationState === 'loading' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Volume2 />
              )}
            </Button>
            {showStar && (
              <Button
                aria-label={isStarred ? '取消标星' : '加入默认生词本'}
                className="no-drag size-7 shrink-0 disabled:opacity-100"
                disabled={payload.state !== 'content' || !starStatusReady || togglingStar}
                onClick={() => void toggleStar()}
                size="icon"
                title={isStarred ? '取消标星' : '加入默认生词本'}
                type="button"
                variant="ghost"
              >
                {togglingStar ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Star className={isStarred ? 'fill-amber-400 text-amber-400' : ''} />
                )}
              </Button>
            )}
            <Button
              aria-label="在主窗口中打开"
              className="no-drag size-7 shrink-0"
              onClick={() => window.dictolSelectionExplanation.openInMain()}
              size="icon"
              title="在主窗口中打开"
              type="button"
              variant="ghost"
            >
              <ExternalLink />
            </Button>
          </>
        )}
        <Button
          aria-label="关闭解释窗口"
          className="no-drag size-7 shrink-0"
          onClick={() => window.dictolSelectionExplanation.close()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </header>

      {hasDictionarySwitcher && (
        <div
          className="no-drag relative flex shrink-0 flex-col bg-[var(--dictionary-toolbar-background)]"
          style={{ height: SELECTION_EXPLANATION_DICTIONARY_SWITCHER_HEIGHT }}
        >
          <div
            className="relative flex w-full shrink-0 items-center overflow-visible"
            style={{ height: SELECTION_EXPLANATION_DICTIONARY_TAB_BAR_HEIGHT }}
          >
            <ScrollArea
              horizontalWheel
              className="h-full w-full"
              viewportClassName="[&>div]:h-full"
            >
              <div className="flex h-full w-max items-center gap-1.5 px-2">
                {dictionaries.map((dictionary) => {
                  const isActive = dictionary.dictionaryId === payload.activeDictionaryId
                  return (
                    <Button
                      key={dictionary.dictionaryId}
                      aria-label={dictionary.dictionaryName}
                      aria-pressed={isActive}
                      className="dictionary-tab-trigger group"
                      data-state={isActive ? 'active' : 'inactive'}
                      onClick={() => {
                        if (!isActive) {
                          window.dictolSelectionExplanation.selectDictionary(
                            dictionary.dictionaryId
                          )
                        }
                      }}
                      size="icon"
                      title={dictionary.dictionaryName}
                      type="button"
                      variant="ghost"
                    >
                      <DictionaryTabIcon
                        iconUrl={dictionary.dictionaryIconUrl}
                        name={dictionary.dictionaryName}
                      />
                    </Button>
                  )
                })}
              </div>
              <ScrollBar className="h-2" orientation="horizontal" />
            </ScrollArea>
            {payload.state === 'refreshing' && <DictionaryLoadingIndicator />}
          </div>
          <div aria-hidden="true" className="h-px w-full shrink-0 bg-border" />
        </div>
      )}

      {payload.mode === 'ai' && payload.state === 'content' ? (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm leading-6">
          <AiRichText content={payload.content || 'AI 没有返回解释。'} />
        </main>
      ) : payload.state !== 'content' && payload.state !== 'refreshing' ? (
        <main className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
          {payload.state === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在查询…
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium">
                {payload.mode === 'ai'
                  ? 'AI 查询失败'
                  : payload.state === 'empty'
                    ? '没有找到词条解释'
                    : '加载词条失败'}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {payload.message ??
                  (payload.mode === 'ai'
                    ? '请检查 AI 服务配置后重试。'
                    : `第一个可用词典中没有“${payload.word}”的解释`)}
              </p>
            </div>
          )}
        </main>
      ) : null}
    </div>
  )
}

function DictionaryLoadingIndicator(): React.JSX.Element {
  return (
    <div
      aria-label="词条内容正在加载"
      className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-0.5 overflow-hidden"
      role="progressbar"
    >
      <div className="native-view-loading-indicator h-full bg-primary" />
    </div>
  )
}
