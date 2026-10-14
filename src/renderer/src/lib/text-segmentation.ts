type WordSegmenter = new (
  locales?: string | string[],
  options?: { granularity: 'word' }
) => {
  segment: (input: string) => Iterable<{ segment: string; index: number; isWordLike?: boolean }>
}

const Segmenter = (Intl as typeof Intl & { Segmenter: WordSegmenter }).Segmenter
const wordSegmenter = new Segmenter(undefined, { granularity: 'word' })

export type TextSegment = {
  segment: string
  index: number
  isWordLike: boolean
}

export function segmentTextByWord(text: string): TextSegment[] {
  return Array.from(wordSegmenter.segment(text), (part) => ({
    segment: part.segment,
    index: part.index,
    isWordLike: Boolean(part.isWordLike)
  }))
}
