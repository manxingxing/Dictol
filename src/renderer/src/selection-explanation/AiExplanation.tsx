import { LoaderCircle } from 'lucide-react'

import { AiRichText } from '@/components/AiRichText'
import type { SelectionExplanationPayload } from '../../../shared/selection-explanation'
import { SelectionExplanationHeader } from './SelectionExplanationHeader'

type Props = {
  payload: SelectionExplanationPayload
}

export function AiExplanation({ payload }: Props): React.JSX.Element {
  return (
    <>
      <SelectionExplanationHeader title="AI 查词" subtitle={payload.word} />
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
