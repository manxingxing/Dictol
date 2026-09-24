import { useEffect, useState } from 'react'

import { useChromeTone } from '@/hooks/use-chrome-tone'
import type { SelectionExplanationPayload } from '../../../shared/selection-explanation'
import { AiExplanation } from './AiExplanation'
import { DictionaryExplanation } from './DictionaryExplanation'

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
  useEffect(() => window.dictolSelectionExplanation.onUpdate(setPayload), [])

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-xl">
      {payload.mode === 'ai' ? (
        <AiExplanation payload={payload} />
      ) : (
        <DictionaryExplanation payload={payload} />
      )}
    </div>
  )
}
