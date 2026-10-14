import { useEffect, useState } from 'react'

import { useAppChrome } from '@/hooks/use-app-chrome'
import type { SelectionExplanationPayload } from '../../../shared/selection-explanation'
import type { TtsPlayback } from '../../../shared/tts'
import { AiExplanation } from './AiExplanation'
import { DictionaryExplanation } from './DictionaryExplanation'

declare global {
  interface Window {
    dictolSelectionExplanation: {
      tts: TtsPlayback
      onUpdate: (callback: (payload: SelectionExplanationPayload) => void) => () => void
      loadingReady: (requestId: number) => void
      selectDictionary: (dictionaryId: string) => void
      close: () => void
      openInMain: () => void
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
  useAppChrome()

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
