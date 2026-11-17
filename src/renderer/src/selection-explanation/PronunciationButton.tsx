import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Pause, Volume2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { playText } from '../selection-translation/tts-playback'

export function PronunciationButton({
  word,
  disabled = false,
  label = '发音',
  className = ''
}: {
  word: string
  disabled?: boolean
  label?: string
  className?: string
}): React.JSX.Element {
  const wordKey = word.trim()
  const playback = useRef<AbortController | null>(null)
  const [pronunciation, setPronunciation] = useState<{
    word: string
    state: 'waiting' | 'playing'
  } | null>(null)
  const state = pronunciation?.word === wordKey ? pronunciation.state : 'idle'

  useEffect(() => () => playback.current?.abort(), [wordKey])

  const toggle = (): void => {
    if (state !== 'idle') {
      playback.current?.abort()
      return
    }
    const controller = new AbortController()
    playback.current = controller
    const tts = window.dictolSelectionExplanation.tts
    void playText(
      {
        speak: (text, notify) =>
          tts.speak(text, (nextState, message) => {
            if (nextState === 'aborted' && playback.current === controller) {
              playback.current = null
              setPronunciation(null)
            }
            notify(nextState, message)
          }),
        stop: () => tts.stop()
      },
      wordKey,
      controller.signal,
      (nextState) => setPronunciation({ word: wordKey, state: nextState })
    )
      .catch((error: unknown) => {
        window.alert(error instanceof Error ? error.message : '朗读失败。')
      })
      .finally(() => {
        if (playback.current === controller) {
          playback.current = null
          setPronunciation(null)
        }
      })
  }

  return (
    <Button
      aria-label={state === 'idle' ? label : `停止${label}`}
      className={`no-drag size-7 shrink-0 ${className}`}
      disabled={disabled || !wordKey}
      onClick={toggle}
      size="icon"
      title={state === 'idle' ? label : `停止${label}`}
      type="button"
      variant="ghost"
    >
      {state === 'waiting' ? (
        <LoaderCircle className="animate-spin" />
      ) : state === 'playing' ? (
        <Pause />
      ) : (
        <Volume2 />
      )}
    </Button>
  )
}
