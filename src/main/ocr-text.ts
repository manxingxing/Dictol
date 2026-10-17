export type OcrObservation = {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence?: number
  /** UTF-16 ranges and Vision-normalized boxes; accurate recognition has word-level geometry. */
  characters?: Array<{
    start: number
    length: number
    x: number
    y: number
    width: number
    height: number
  }>
}

export type OcrSelection = {
  word: string
  sentence: string
  context: string
}

export type OcrTextHit = {
  selection: OcrSelection
  confidence?: number
  bounds: { x: number; y: number; width: number; height: number }
  contextBounds: { x: number; y: number; width: number; height: number }
}

type WordRange = { start: number; length: number }

type Line = OcrObservation & { top: number; bottom: number }

type SentenceContext = {
  sentence: string
  context: string
  start: number
  end: number
}

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
const paragraphBreaks = ['\n', '\r', '\u2029']

export function sentenceContextAt(text: string, offset: number): SentenceContext | null {
  if (offset < 0 || offset >= text.length) return null
  const paragraphStart =
    Math.max(...paragraphBreaks.map((separator) => text.lastIndexOf(separator, offset - 1))) + 1
  const paragraphEnd = Math.min(
    text.length,
    ...paragraphBreaks
      .map((separator) => text.indexOf(separator, offset))
      .filter((position) => position >= 0)
  )
  const paragraph = text.slice(paragraphStart, paragraphEnd)
  const sentences: { text: string; start: number; end: number }[] = []
  for (const part of sentenceSegmenter.segment(paragraph)) {
    const previous = sentences.at(-1)
    if (
      previous &&
      /\.(?:[（(]\s*)?$/u.test(previous.text) &&
      /^(?:[（(]\s*)?\p{Script=Han}/u.test(part.segment) &&
      !/\s/u.test(paragraph[part.index - 1])
    ) {
      previous.text += part.segment.trimEnd()
      previous.end = paragraphStart + part.index + part.segment.length
    } else {
      sentences.push({
        text: part.segment.trim(),
        start: paragraphStart + part.index,
        end: paragraphStart + part.index + part.segment.length
      })
    }
  }
  const current = sentences.findIndex((part) => offset >= part.start && offset < part.end)
  if (current < 0) return null
  const start = sentences[Math.max(0, current - 1)].start
  const end = sentences[Math.min(sentences.length - 1, current + 1)].end
  return {
    sentence: sentences[current].text,
    context: text.slice(start, end).trim(),
    start,
    end
  }
}

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
  const characterOffset =
    characterOffsetFromVision(target, pointer.x) ??
    characters.slice(0, approximateIndex).join('').length

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
      const upper = preceding ? next : edge
      const lower = preceding ? edge : next
      if (isHeadingBoundary(upper, lower) || isEntryBoundary(lower)) break
      paragraph.push(next)
      edge = next
    }
  }
  paragraph.sort((a, b) => (sharesVisualLine(a, b) ? a.x - b.x : a.top - b.top || a.x - b.x))

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
  if (
    /\p{Script=Han}/u.test(segment.segment) &&
    !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(target.text) &&
    chineseWordRange
  ) {
    const range = chineseWordRange(text, targetOffset)
    if (range && range.start <= targetOffset && targetOffset < range.start + range.length) {
      const nativeWord = text.slice(range.start, range.start + range.length)
      if (/^\p{Script=Han}+$/u.test(nativeWord)) {
        word = { text: nativeWord, index: range.start }
      }
    }
  }

  const sentenceContext = sentenceContextAt(text, targetOffset)
  if (!sentenceContext) return null
  const contextStart = sentenceContext.start
  const contextEnd = sentenceContext.end
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
  const visionBounds = wordBoundsFromVision(
    target,
    wordStart + target.text.length - target.text.trimStart().length,
    wordEnd + target.text.length - target.text.trimStart().length
  )
  return {
    selection: {
      word: word.text,
      sentence: sentenceContext.sentence,
      context: sentenceContext.context
    },
    confidence: target.confidence,
    bounds: visionBounds ?? {
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

function characterOffsetFromVision(line: Line, pointerX: number): number | null {
  const boxes = line.characters?.filter((box) => box.width > 0 && box.length > 0)
  if (!boxes?.length) return null
  const distance = (box: (typeof boxes)[number]): number =>
    Math.max(box.x - pointerX, 0, pointerX - box.x - box.width)
  const nearest = boxes.reduce((best, box) => (distance(box) < distance(best) ? box : best))
  const sameWord = boxes.filter(
    (box) =>
      Math.abs(box.x - nearest.x) < 0.0001 &&
      Math.abs(box.width - nearest.width) < 0.0001 &&
      Math.abs(box.y - nearest.y) < 0.0001 &&
      Math.abs(box.height - nearest.height) < 0.0001
  )
  const position = Math.max(0, Math.min(0.999, (pointerX - nearest.x) / nearest.width))
  return sameWord[Math.floor(position * sameWord.length)].start
}

function wordBoundsFromVision(line: Line, start: number, end: number): OcrTextHit['bounds'] | null {
  const boxes = line.characters?.filter(
    (box) => box.start < end && box.start + box.length > start && box.width > 0 && box.height > 0
  )
  if (!boxes?.length) return null
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => 1 - box.y - box.height))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => 1 - box.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
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
  if (sharesVisualLine(edge, candidate)) {
    const horizontalGap = preceding
      ? edge.x - candidate.x - candidate.width
      : candidate.x - edge.x - edge.width
    return (
      (preceding ? candidate.x < edge.x : candidate.x > edge.x) &&
      heightRatio >= 0.7 &&
      heightRatio <= 1.4 &&
      horizontalGap * aspectRatio >= -lineHeight * 0.25 &&
      horizontalGap * aspectRatio <= lineHeight * 1.5
    )
  }
  return (
    (preceding ? candidate.top < edge.top : candidate.top > edge.top) &&
    heightRatio >= 0.7 &&
    heightRatio <= 1.4 &&
    verticalGap >= -lineHeight * 0.25 &&
    verticalGap <= lineHeight * 0.45 &&
    Math.abs(candidate.x - anchor.x) * aspectRatio <= anchor.height * 2
  )
}

function sharesVisualLine(first: Line, second: Line): boolean {
  const overlap = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
  return overlap >= Math.min(first.height, second.height) * 0.65
}

function isHeadingBoundary(upper: Line, lower: Line): boolean {
  return (
    upper.width < lower.width * 0.5 &&
    !/[.!?。！？,，:：;；-]/u.test(upper.text) &&
    /^\p{Lu}/u.test(lower.text)
  )
}

function isEntryBoundary(line: Line): boolean {
  return (
    /^\s*(?:\d{1,2}|[A-Za-z])\s*:\s*\p{L}/u.test(line.text) ||
    /^\s*(?:\[[^\n]{1,24}\]|［[^\n]{1,24}］)\s*$/u.test(line.text)
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
