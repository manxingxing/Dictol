import { useState } from 'react'
import { Check, LoaderCircle, Quote } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { SelectionExplanationPayload } from '../../../shared/selection-explanation'
import { SelectionExplanationHeader } from './SelectionExplanationHeader'

export function OcrAiExplanation({
  payload
}: {
  payload: SelectionExplanationPayload
}): React.JSX.Element {
  const [saveAttempt, setSaveAttempt] = useState<{
    requestId: number
    state: 'saving' | 'saved' | 'error'
  } | null>(null)
  const saveState = saveAttempt?.requestId === payload.requestId ? saveAttempt.state : 'idle'
  const explanation = payload.ocrExplanation
  const hasOcrText = Boolean(payload.word && payload.ocrSentence)

  const save = async (): Promise<void> => {
    setSaveAttempt({ requestId: payload.requestId, state: 'saving' })
    try {
      await window.dictolSelectionExplanation.saveOcrExplanationAsExcerpt(payload.requestId)
      setSaveAttempt({ requestId: payload.requestId, state: 'saved' })
    } catch (error) {
      console.error('Failed to save OCR explanation', error)
      setSaveAttempt({ requestId: payload.requestId, state: 'error' })
    }
  }

  return (
    <>
      <SelectionExplanationHeader title="悬停 AI 解释" pinned={payload.pinned}>
        <Button
          aria-label={saveState === 'saved' ? '已保存到摘抄与笔记' : '保存到摘抄与笔记'}
          className="no-drag size-7 shrink-0 disabled:opacity-100"
          disabled={!explanation || saveState === 'saving' || saveState === 'saved'}
          onClick={() => void save()}
          size="icon"
          title={saveState === 'error' ? '保存失败，点击重试' : '保存到摘抄与笔记'}
          type="button"
          variant="ghost"
        >
          {saveState === 'saving' ? (
            <LoaderCircle className="animate-spin" />
          ) : saveState === 'saved' ? (
            <Check />
          ) : (
            <Quote className={saveState === 'error' ? 'text-destructive' : ''} />
          )}
        </Button>
      </SelectionExplanationHeader>
      {hasOcrText ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <section className="px-5 pb-4 pt-4">
            <h1 className="break-words text-xl font-semibold leading-7">{payload.word}</h1>
            {payload.state === 'content' && explanation ? (
              <div className="mt-2.5">
                <p className="select-text text-sm leading-6">{explanation.wordMeaning}</p>
                {explanation.usage && (
                  <p className="mt-2 select-text text-xs leading-5 text-muted-foreground">
                    用法 · {explanation.usage}
                  </p>
                )}
              </div>
            ) : payload.state === 'loading' ? (
              <p className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                正在解释原句…
              </p>
            ) : (
              <p className="mt-2.5 text-sm leading-6 text-destructive">
                {payload.message ?? 'AI 解释失败，请检查 AI 服务配置后重试。'}
              </p>
            )}
          </section>
          <section className="border-t border-border px-5 pb-5 pt-3.5">
            <p className="select-text break-words text-[13px] leading-[1.6] text-muted-foreground">
              {payload.ocrSentence}
            </p>
            {payload.state === 'content' && explanation && (
              <p className="mt-2 select-text text-sm leading-6">{explanation.sentenceMeaning}</p>
            )}
          </section>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
          {payload.state === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在识别屏幕文字…
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium">悬停 AI 解释失败</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {payload.message ?? '请检查 AI 服务配置后重试。'}
              </p>
            </div>
          )}
        </main>
      )}
    </>
  )
}
