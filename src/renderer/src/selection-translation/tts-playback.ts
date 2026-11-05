import { TTS_MAX_TEXT_LENGTH, type TtsPlayback } from '../../../shared/tts'

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

function packSegments(segments: Iterable<string>): string[] {
  const chunks: string[] = []
  let current = ''
  for (const segment of segments) {
    if (current.length + segment.length > TTS_MAX_TEXT_LENGTH) {
      chunks.push(current)
      current = ''
    }
    current += segment
  }
  if (current) chunks.push(current)
  return chunks
}

export function splitTextForSpeech(text: string): string[] {
  const content = text.replace(/\s+/g, ' ').trim()
  const sentences = Array.from(sentenceSegmenter.segment(content), ({ segment }) => segment)
  const segments = sentences.flatMap((sentence) => {
    if (sentence.length <= TTS_MAX_TEXT_LENGTH) return [sentence]
    const clauses = sentence.split(/(?<=[,;，；、])/u)
    return packSegments(
      clauses.flatMap((clause) => {
        if (clause.length <= TTS_MAX_TEXT_LENGTH) return [clause]
        const words = Array.from(wordSegmenter.segment(clause), ({ segment }) => segment)
        return packSegments(
          words.flatMap((word) =>
            word.length <= TTS_MAX_TEXT_LENGTH ? [word] : packSegments(Array.from(word))
          )
        )
      })
    )
  })
  return packSegments(segments)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
}

export async function playText(
  playback: TtsPlayback,
  text: string,
  signal: AbortSignal,
  onStateChange?: (state: 'waiting' | 'playing') => void
): Promise<void> {
  const stop = (): void => playback.stop()
  signal.addEventListener('abort', stop, { once: true })
  try {
    for (const chunk of splitTextForSpeech(text)) {
      if (signal.aborted) return
      const completed = await new Promise<boolean>((resolve, reject) => {
        playback.speak(chunk, (state, message) => {
          if (state === 'waiting' || state === 'playing') onStateChange?.(state)
          if (state === 'completed') resolve(true)
          if (state === 'aborted') resolve(false)
          if (state === 'error') reject(new Error(message || '朗读失败，请检查语音服务配置。'))
        })
      })
      if (!completed) return
    }
  } finally {
    signal.removeEventListener('abort', stop)
  }
}
