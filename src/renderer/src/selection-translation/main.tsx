import '@/assets/main.css'
import './selection-translation.css'
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { SelectionTranslationWorkbench } from './SelectionTranslationWorkbench'
import type {
  SelectionTranslationPayload,
  TranslationEvent,
  TranslationPublicConfig,
  TranslationRequest
} from '../../../shared/translation'

declare global {
  interface Window {
    dictolSelectionTranslation: {
      onUpdate: (callback: (payload: SelectionTranslationPayload) => void) => () => void
      getConfig: () => Promise<TranslationPublicConfig | null>
      start: (request: TranslationRequest) => Promise<string | null>
      cancel: (requestId: string) => void
      onEvent: (callback: (event: TranslationEvent) => void) => () => void
      togglePin: () => Promise<boolean>
      close: () => void
      setDesiredHeight: (version: number, height: number) => void
    }
  }
}

export function SelectionTranslationApp(): React.JSX.Element {
  const [selection, setSelection] = useState<SelectionTranslationPayload>()
  useEffect(() => window.dictolSelectionTranslation.onUpdate(setSelection), [])
  return (
    <SelectionTranslationWorkbench
      api={window.dictolSelectionTranslation}
      key={selection?.version ?? 0}
      onClose={() => window.dictolSelectionTranslation.close()}
      onTogglePin={window.dictolSelectionTranslation.togglePin}
      selection={selection}
      setDesiredHeight={window.dictolSelectionTranslation.setDesiredHeight}
    />
  )
}

createRoot(document.getElementById('root')!).render(<SelectionTranslationApp />)
