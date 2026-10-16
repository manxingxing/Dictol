export type OcrObservation = {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export type OcrSelection = {
  word: string
  sentence: string
  context: string
}

export type OcrTextHit = {
  selection: OcrSelection
  bounds: { x: number; y: number; width: number; height: number }
  contextBounds: { x: number; y: number; width: number; height: number }
}

type WordRange = { start: number; length: number }

type Line = OcrObservation & { top: number; bottom: number }

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })

/** Vision boxes use a bottom-left origin; pointer coordinates use a top-left origin. */
export function selectOcrText(
  observations: OcrObservation[],
  pointer: { x: number; y: number },
  aspectRatio = 1
): OcrSelection | null {
  return selectOcrTextHit(observations, pointer, aspectRatio)?.selection ?? null
}

export function selectOcrTextHit(
  observations: OcrObservation[],
  pointer: { x: number; y: number },
  aspectRatio = 1,
  chineseWordRange?: (text: string, offset: number) => WordRange | null
): OcrTextHit | null {
  const lines: Line[] = observations
    .filter((item) => item.text.trim() && item.width > 0 && item.height > 0)
    .map((item) => ({ ...item, top: 1 - item.y - item.height, bottom: 1 - item.y }))
    .sort((a, b) => a.top - b.top || a.x - b.x)
  const hit = lines.findIndex(
    (line) =>
      pointer.x >= line.x &&
      pointer.x <= line.x + line.width &&
      pointer.y >= line.top &&
      pointer.y <= line.bottom
  )
  if (hit < 0) return null

  const target = lines[hit]
  const characters = Array.from(target.text)
  const mixedCjkLatin = hasMixedCjkLatin(target.text)
  const visualWidths = characters.map((character) => characterWidth(character, mixedCjkLatin))
  const targetVisualWidth = visualWidths.reduce((total, width) => total + width, 0)
  const pointerVisualOffset = ((pointer.x - target.x) / target.width) * targetVisualWidth
  let approximateIndex = 0
  let precedingVisualWidth = 0
  while (
    approximateIndex < characters.length - 1 &&
    pointerVisualOffset >= precedingVisualWidth + visualWidths[approximateIndex]
  ) {
    precedingVisualWidth += visualWidths[approximateIndex]
    approximateIndex++
  }
  const characterOffset = characters.slice(0, approximateIndex).join('').length

  const paragraph = [target]
  for (const preceding of [true, false]) {
    let edge = target
    for (let count = 0; count < 40; count++) {
      const next = lines
        .filter(
          (line) =>
            !paragraph.includes(line) && isAdjacentLine(edge, line, target, preceding, aspectRatio)
        )
        .sort(
          (a, b) =>
            Math.abs(a.top - edge.top) - Math.abs(b.top - edge.top) ||
            Math.abs(a.x - target.x) - Math.abs(b.x - target.x)
        )[0]
      if (!next) break
      if (isHeadingBoundary(preceding ? next : edge, preceding ? edge : next)) break
      paragraph.push(next)
      edge = next
    }
  }
  paragraph.sort((a, b) => a.top - b.top || a.x - b.x)

  let text = ''
  let targetOffset = 0
  let targetStart = 0
  const lineRanges: { line: Line; start: number; end: number }[] = []
  for (const line of paragraph) {
    if (text) text += needsSpace(text, line.text) ? ' ' : ''
    const start = text.length
    if (line === target) {
      targetStart = text.length
      const leadingSpaceLength = line.text.length - line.text.trimStart().length
      targetOffset = text.length + Math.max(0, characterOffset - leadingSpaceLength)
    }
    text += line.text.trim()
    lineRanges.push({ line, start, end: text.length })
  }

  const segment = Array.from(wordSegmenter.segment(text)).find(
    (part) =>
      part.isWordLike &&
      targetOffset >= part.index &&
      targetOffset < part.index + part.segment.length
  )
  if (!segment) return null
  let word = expandCompoundWord(text, segment.index, segment.segment)
  if (/\p{Script=Han}/u.test(segment.segment) && chineseWordRange) {
    const range = chineseWordRange(text, targetOffset)
    if (range && range.start <= targetOffset && targetOffset < range.start + range.length) {
      const nativeWord = text.slice(range.start, range.start + range.length)
      if (/^\p{Script=Han}+$/u.test(nativeWord)) {
        word = { text: nativeWord, index: range.start }
      }
    }
  }

  const sentences = Array.from(sentenceSegmenter.segment(text)).map((part) => ({
    text: part.segment.trim(),
    start: part.index,
    end: part.index + part.segment.length
  }))
  const current = sentences.findIndex(
    (part) => targetOffset >= part.start && targetOffset < part.end
  )
  if (current < 0) return null
  const contextStart = sentences[Math.max(0, current - 1)].start
  const contextEnd = sentences[Math.min(sentences.length - 1, current + 1)].end
  const contextLines = lineRanges
    .filter(({ start, end }) => start < contextEnd && end > contextStart)
    .map(({ line }) => line)
  const contextLeft = Math.min(...contextLines.map((line) => line.x))
  const contextTop = Math.min(...contextLines.map((line) => line.top))
  const contextRight = Math.max(...contextLines.map((line) => line.x + line.width))
  const contextBottom = Math.max(...contextLines.map((line) => line.bottom))
  const targetLength = target.text.trim().length
  const wordStart = Math.max(0, Math.min(targetLength, word.index - targetStart))
  const wordEnd = Math.max(
    wordStart,
    Math.min(targetLength, word.index + word.text.length - targetStart)
  )
  const targetText = target.text.trim()
  const targetTextVisualWidth = visualWidth(targetText, mixedCjkLatin)
  const wordLeft = visualWidth(targetText.slice(0, wordStart), mixedCjkLatin)
  const wordRight = visualWidth(targetText.slice(0, wordEnd), mixedCjkLatin)
  return {
    selection: {
      word: word.text,
      sentence: sentences[current].text,
      context: text.slice(contextStart, contextEnd).trim()
    },
    bounds: {
      x: target.x + (wordLeft / targetTextVisualWidth) * target.width,
      y: target.top,
      width: ((wordRight - wordLeft) / targetTextVisualWidth) * target.width,
      height: target.height
    },
    contextBounds: {
      x: contextLeft,
      y: contextTop,
      width: contextRight - contextLeft,
      height: contextBottom - contextTop
    }
  }
}

function hasMixedCjkLatin(text: string): boolean {
  return (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text) &&
    /[\p{Script=Latin}\p{Number}]/u.test(text)
  )
}

function characterWidth(character: string, mixedCjkLatin: boolean): number {
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) {
    return 1
  }
  if (/\s/u.test(character)) return mixedCjkLatin ? 0.35 : 0.4

  let width = 0.7
  if (/[ilI|!.,'`:;]/u.test(character)) width = 0.4
  else if (/[mwMW@%&]/u.test(character)) width = 1.3
  else if (/\p{Number}/u.test(character)) width = 0.7
  else if (/\p{Lu}/u.test(character)) width = 0.9
  else if (/\p{P}|\p{S}/u.test(character)) width = 0.5

  return mixedCjkLatin && /\p{Script=Latin}|\p{Number}/u.test(character) ? width * 0.45 : width
}

function visualWidth(text: string, mixedCjkLatin: boolean): number {
  return Array.from(text).reduce(
    (total, character) => total + characterWidth(character, mixedCjkLatin),
    0
  )
}

function isAdjacentLine(
  edge: Line,
  candidate: Line,
  anchor: Line,
  preceding: boolean,
  aspectRatio: number
): boolean {
  const upper = preceding ? candidate : edge
  const lower = preceding ? edge : candidate
  const verticalGap = lower.top - upper.bottom
  const lineHeight = Math.max(edge.height, candidate.height)
  const heightRatio = candidate.height / anchor.height
  return (
    (preceding ? candidate.top < edge.top : candidate.top > edge.top) &&
    heightRatio >= 0.7 &&
    heightRatio <= 1.4 &&
    verticalGap >= -lineHeight * 0.25 &&
    verticalGap <= lineHeight * 1.1 &&
    Math.abs(candidate.x - anchor.x) * aspectRatio <= anchor.height * 2
  )
}

function isHeadingBoundary(upper: Line, lower: Line): boolean {
  return (
    upper.width < lower.width * 0.5 &&
    !/[.!?。！？,，:：;；-]/u.test(upper.text) &&
    /^\p{Lu}/u.test(lower.text)
  )
}

function expandCompoundWord(
  text: string,
  index: number,
  segment: string
): { text: string; index: number } {
  if (!/^[A-Za-z0-9]/u.test(segment)) return { text: segment, index }
  let start = index
  let end = index + segment.length
  while (start > 0 && /[A-Za-z0-9_’'-]/u.test(text[start - 1])) start--
  while (end < text.length && /[A-Za-z0-9_’'-]/u.test(text[end])) end++
  return { text: text.slice(start, end).replace(/^[-_’']+|[-_’']+$/gu, ''), index: start }
}

function needsSpace(left: string, right: string): boolean {
  return (
    /[\p{Script=Latin}\p{Number}.!?]$/u.test(left) && /^[\p{Script=Latin}\p{Number}]/u.test(right)
  )
}
