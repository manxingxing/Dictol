import { useState } from 'react'
import { BookOpen, Check, LoaderCircle, Quote } from 'lucide-react'
import StarterKit from '@tiptap/starter-kit'
import { MarkdownManager } from '@tiptap/markdown'

import { AiRichText } from '@/components/AiRichText'
import { Button } from '@/components/ui/button'
import type { SelectionExplanationPayload } from '../../../shared/selection-explanation'
import { ExplanationWordActions } from './ExplanationWordActions'
import { SelectionExplanationHeader } from './SelectionExplanationHeader'

type Props = {
  payload: SelectionExplanationPayload
}

export function AiExplanation({ payload }: Props): React.JSX.Element {
  const [saveAttempt, setSaveAttempt] = useState<{
    requestId: number
    state: 'saving' | 'saved' | 'error'
  } | null>(null)
  const saveState = saveAttempt?.requestId === payload.requestId ? saveAttempt.state : 'idle'
  const saveExplanation = async (): Promise<void> => {
    setSaveAttempt({ requestId: payload.requestId, state: 'saving' })
    try {
      const markdown = new MarkdownManager({ extensions: [StarterKit] })
      const commentRich = JSON.stringify(markdown.parse(payload.content ?? ''))
      await window.dictolSelectionExplanation.saveAiExplanationAsNote(commentRich)
      setSaveAttempt({ requestId: payload.requestId, state: 'saved' })
    } catch (error) {
      console.error('Failed to save AI explanation as note', error)
      setSaveAttempt({ requestId: payload.requestId, state: 'error' })
    }
  }

  return (
    <>
      <SelectionExplanationHeader
        title={payload.word}
        onSearch={(word) => window.dictolSelectionExplanation.lookupWord(word)}
        pinned={payload.pinned}
      >
        <Button
          aria-label={saveState === 'saved' ? '已保存到摘抄与笔记' : '保存到摘抄与笔记'}
          className="no-drag size-7 shrink-0 disabled:opacity-100"
          disabled={
            payload.state !== 'content' ||
            payload.complete !== true ||
            !payload.content?.trim() ||
            saveState === 'saving' ||
            saveState === 'saved'
          }
          onClick={() => void saveExplanation()}
          size="icon"
          title={
            saveState === 'saved'
              ? '已保存到摘抄与笔记'
              : saveState === 'error'
                ? '保存失败，点击重试'
                : '保存到摘抄与笔记'
          }
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
        <Button
          aria-label="返回词典解释"
          className="no-drag size-7 shrink-0"
          onClick={() => window.dictolSelectionExplanation.lookupWord(payload.word)}
          size="icon"
          title="返回词典解释"
          type="button"
          variant="ghost"
        >
          <BookOpen />
        </Button>
        <ExplanationWordActions payload={payload} />
      </SelectionExplanationHeader>
      {payload.state === 'content' ? (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm leading-6">
          <AiRichText content={payload.content || 'AI 没有返回解释。'} />
        </main>
      ) : payload.state !== 'refreshing' ? (
        <main className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
          {payload.state === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在查询…
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium">AI 查询失败</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {payload.message ?? '请检查 AI 服务配置后重试。'}
              </p>
            </div>
          )}
        </main>
      ) : null}
    </>
  )
}
