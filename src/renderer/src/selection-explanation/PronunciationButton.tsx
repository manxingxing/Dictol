import { useEffect, useState } from 'react'
import { LoaderCircle, Square, Volume2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function PronunciationButton({
  word,
  disabled = false
}: {
  word: string
  disabled?: boolean
}): React.JSX.Element {
  const wordKey = word.trim()
  const [pronunciation, setPronunciation] = useState<{
    word: string
    state: 'waiting' | 'playing'
  } | null>(null)
  const state = pronunciation?.word === wordKey ? pronunciation.state : 'idle'

  useEffect(() => () => window.dictolSelectionExplanation.tts.stop(), [wordKey])

  const toggle = (): void => {
    if (state !== 'idle') {
      window.dictolSelectionExplanation.tts.stop()
      return
    }
    window.dictolSelectionExplanation.tts.speak(wordKey, (nextState, message) => {
      setPronunciation(
        nextState === 'waiting' || nextState === 'playing'
          ? { word: wordKey, state: nextState }
          : null
      )
      if (nextState === 'error') window.alert(message || '朗读失败。')
    })
  }

  return (
    <Button
      aria-label={state === 'idle' ? '发音' : '停止发音'}
      className="no-drag size-7 shrink-0"
      disabled={disabled || !wordKey}
      onClick={toggle}
      size="icon"
      title={state === 'idle' ? '发音' : '停止发音'}
      type="button"
      variant="ghost"
    >
      {state === 'waiting' ? (
        <LoaderCircle className="animate-spin" />
      ) : state === 'playing' ? (
        <Square />
      ) : (
        <Volume2 />
      )}
    </Button>
  )
}
