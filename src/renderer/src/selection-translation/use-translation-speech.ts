import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { playText } from './tts-playback'

export function useTranslationSpeech(text: string): {
  state: 'idle' | 'waiting' | 'playing'
  error: Error | null
  toggle: () => void
} {
  const controllerRef = useRef<AbortController | null>(null)
  const [playbackState, setPlaybackState] = useState<'waiting' | 'playing'>('waiting')
  const mutation = useMutation({
    mutationFn: ({ text, signal }: { text: string; signal: AbortSignal }) =>
      playText(window.dictolSelectionTranslation.tts, text, signal, (state) => {
        if (!signal.aborted) setPlaybackState(state)
      }),
    retry: false
  })
  const stop = useCallback((): void => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  useEffect(() => stop, [text, stop])

  const toggle = (): void => {
    if (mutation.isPending) {
      stop()
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setPlaybackState('waiting')
    mutation.mutate({ text, signal: controller.signal })
  }

  return { state: mutation.isPending ? playbackState : 'idle', error: mutation.error, toggle }
}
