import { useEffect, useState } from 'react'
import { LoaderCircle, Square, Volume2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { DictionaryTabIcon } from '@/components/DictionaryIcon'
import {
  SELECTION_EXPLANATION_DICTIONARY_TAB_BAR_HEIGHT,
  SELECTION_EXPLANATION_DICTIONARY_SWITCHER_HEIGHT,
  type SelectionExplanationPayload
} from '../../../shared/selection-explanation'
import { ExplanationWordActions } from './ExplanationWordActions'
import { SelectionExplanationHeader } from './SelectionExplanationHeader'

type Props = {
  payload: SelectionExplanationPayload
}

export function DictionaryExplanation({ payload }: Props): React.JSX.Element {
  const wordKey = payload.word.trim()
  const [pronunciation, setPronunciation] = useState<{
    word: string
    state: 'waiting' | 'playing'
  } | null>(null)
  const pronunciationState = pronunciation?.word === wordKey ? pronunciation.state : 'idle'
  const dictionaries = payload.dictionaries ?? []
  const hasDictionarySwitcher = dictionaries.length > 1
  useEffect(() => {
    if (payload.state !== 'loading' || payload.requestId === 0) return
    window.dictolSelectionExplanation.loadingReady(payload.requestId)
  }, [payload.requestId, payload.state])
  useEffect(() => () => window.dictolSelectionExplanation.tts.stop(), [wordKey])

  const togglePronunciation = (): void => {
    if (pronunciationState !== 'idle') {
      window.dictolSelectionExplanation.tts.stop()
      return
    }
    window.dictolSelectionExplanation.tts.speak(wordKey, (state, message) => {
      setPronunciation(state === 'waiting' || state === 'playing' ? { word: wordKey, state } : null)
      if (state === 'error') window.alert(message || '朗读失败。')
    })
  }

  const actions = (
    <>
      <Button
        aria-label={pronunciationState === 'idle' ? '发音' : '停止发音'}
        className="no-drag size-7 shrink-0"
        disabled={payload.state !== 'content' || !wordKey}
        onClick={togglePronunciation}
        size="icon"
        title={pronunciationState === 'idle' ? '发音' : '停止发音'}
        type="button"
        variant="ghost"
      >
        {pronunciationState === 'waiting' ? (
          <LoaderCircle className="animate-spin" />
        ) : pronunciationState === 'playing' ? (
          <Square />
        ) : (
          <Volume2 />
        )}
      </Button>
      {payload.aiEnabled && Boolean(wordKey) && (
        <Button
          aria-label="AI 解释当前词"
          className="no-drag size-7 shrink-0 p-0 text-[11px] font-semibold"
          onClick={() => window.dictolSelectionExplanation.showAi()}
          size="xs"
          title="AI 解释当前词"
          type="button"
          variant="ghost"
        >
          AI
        </Button>
      )}
      <ExplanationWordActions payload={payload} />
    </>
  )

  return (
    <>
      <SelectionExplanationHeader
        title={payload.word || '词典解释'}
        onSearch={(word) => window.dictolSelectionExplanation.lookupWord(word)}
        pinned={payload.pinned}
        subtitle={
          payload.dictionaryName && !hasDictionarySwitcher ? payload.dictionaryName : undefined
        }
      >
        {actions}
      </SelectionExplanationHeader>
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
                        display="icon"
                        iconUrl={dictionary.dictionaryIconUrl}
                        name={dictionary.dictionaryName}
                      />
                    </Button>
                  )
                })}
              </div>
              <ScrollBar className="h-0" orientation="horizontal" />
            </ScrollArea>
            {payload.state === 'refreshing' && <DictionaryLoadingIndicator />}
          </div>
          <div aria-hidden="true" className="h-px w-full shrink-0 bg-border" />
        </div>
      )}

      {payload.state !== 'content' && payload.state !== 'refreshing' && (
        <main className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
          {payload.state === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在查询…
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium">
                {payload.state === 'empty'
                  ? '没有找到词条解释'
                  : payload.word
                    ? '加载词条失败'
                    : '悬停取词失败'}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {payload.message ?? `第一个可用词典中没有“${payload.word}”的解释`}
              </p>
            </div>
          )}
        </main>
      )}
    </>
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
