import { useEffect, useState } from 'react'

import { useAppChrome } from '@/hooks/use-app-chrome'
import type { SelectionExplanationPayload } from '../../../shared/selection-explanation'
import type { TtsPlayback } from '../../../shared/tts'
import { AiExplanation } from './AiExplanation'
import { DictionaryExplanation } from './DictionaryExplanation'
import { OcrAiExplanation } from './OcrAiExplanation'

declare global {
  interface Window {
    dictolSelectionExplanation: {
      tts: TtsPlayback
      nativeRoundedWindow: boolean
      onUpdate: (callback: (payload: SelectionExplanationPayload) => void) => () => void
      loadingReady: (requestId: number) => void
      lookupWord: (word: string) => void
      showAi: () => void
      selectDictionary: (dictionaryId: string) => void
      close: () => void
      togglePin: () => void
      openInMain: () => void
      saveAiExplanationAsNote: (commentRich: string) => Promise<void>
      saveOcrExplanationAsExcerpt: (requestId: number) => Promise<void>
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
    <div
      className={`selection-explanation-window${window.dictolSelectionExplanation.nativeRoundedWindow ? ' native-rounded-window' : ''}`}
    >
      {payload.mode === 'ocr-ai' ? (
        <OcrAiExplanation payload={payload} />
      ) : payload.mode === 'ai' ? (
        <AiExplanation payload={payload} />
      ) : (
        <DictionaryExplanation payload={payload} />
      )}
    </div>
  )
}
