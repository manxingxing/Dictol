import { Fragment, type ReactNode } from 'react'

import { segmentTextByWord } from '@/lib/text-segmentation'

function findMatchRanges(text: string, matches: string[]): { start: number; end: number }[] {
  const ranges = matches.flatMap((match) => {
    if (!match) return []
    const occurrences: { start: number; end: number }[] = []
    let offset = 0
    while (offset < text.length) {
      const start = text.indexOf(match, offset)
      if (start < 0) break
      occurrences.push({ start, end: start + match.length })
      offset = start + Math.max(1, match.length)
    }
    return occurrences
  })
  ranges.sort((left, right) => left.start - right.start || right.end - left.end)

  const merged: { start: number; end: number }[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

export function DictionaryNoteSearchHighlight({
  text,
  matches = [],
  relatedTerms = []
}: {
  text: string
  matches?: string[]
  relatedTerms?: string[]
}): React.JSX.Element {
  const relatedWords = new Set(relatedTerms.map((term) => term.trim().toLocaleLowerCase()))
  const ranges = findMatchRanges(text, matches)

  const renderUnmatched = (value: string, key: string): ReactNode => {
    if (relatedWords.size === 0) return value
    return segmentTextByWord(value).map((part, index) => {
      const isRelatedWord = part.isWordLike && relatedWords.has(part.segment.toLocaleLowerCase())
      return isRelatedWord ? (
        <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground" key={`${key}-${index}`}>
          {part.segment}
        </mark>
      ) : (
        <Fragment key={`${key}-${index}`}>{part.segment}</Fragment>
      )
    })
  }

  if (ranges.length === 0) {
    return <>{renderUnmatched(text, 'text')}</>
  }

  const output: ReactNode[] = []
  let offset = 0
  ranges.forEach((range, index) => {
    output.push(renderUnmatched(text.slice(offset, range.start), `before-${index}`))
    output.push(
      <mark
        className="rounded-sm bg-amber-200/75 px-0.5 text-foreground dark:bg-amber-800/60"
        key={`match-${index}`}
      >
        {text.slice(range.start, range.end)}
      </mark>
    )
    offset = range.end
  })
  output.push(renderUnmatched(text.slice(offset), 'after'))
  return <>{output}</>
}
