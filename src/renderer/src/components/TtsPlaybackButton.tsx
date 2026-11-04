import { useEffect, useState } from 'react'
import { LoaderCircle, Play, Square } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { TtsState } from '../../../shared/tts'

export function TtsPlaybackButton({ disabled }: { disabled: boolean }): React.JSX.Element {
  const [playback, setPlayback] = useState<TtsState | null>(null)

  useEffect(() => () => window.dictol.tts.stop(), [])

  const playing = playback === 'waiting' || playback === 'playing'
  const play = (): void => {
    if (playing) {
      window.dictol.tts.stop()
      setPlayback('aborted')
      return
    }
    window.dictol.tts.speak('Hello World', (state, message) => {
      setPlayback(state)
      if (state === 'error') {
        toast.error('朗读失败', { description: message ?? '请检查语音服务配置后重试。' })
      }
    })
  }

  return (
    <Button
      aria-label={playing ? '停止试听' : '播放 Hello World'}
      title={playing ? '停止试听' : '播放 Hello World'}
      className="w-8 px-0"
      disabled={disabled}
      onClick={play}
      size="sm"
      variant="outline"
    >
      {playback === 'waiting' ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : playback === 'playing' ? (
        <Square className="size-3.5" />
      ) : (
        <Play className="size-4" />
      )}
    </Button>
  )
}
