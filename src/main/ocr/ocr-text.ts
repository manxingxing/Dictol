export type OcrObservation = {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence?: number
  /** Text quadrilateral in reading order, normalized with a top-left origin. */
  quad?: Array<{ x: number; y: number }>
  /** UTF-16 ranges and normalized boxes with a bottom-left origin. */
  characters?: Array<{
    start: number
    length: number
    x: number
    y: number
    width: number
    height: number
    quad?: Array<{ x: number; y: number }>
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
  wordQuad?: Array<{ x: number; y: number }>
  contextBounds: { x: number; y: number; width: number; height: number }
  /** The current OCR crop already contains a sentence on each side. */
  hasBothAdjacentSentences: boolean
}

type WordRange = { start: number; length: number }

type Line = OcrObservation & { top: number; bottom: number }
type Point = { x: number; y: number }
type Interval = { start: number; end: number }
type ProjectedLine = {
  line: Line
  inline: Interval
  axis: Interval
  axisCenter: number
  height: number
  glyphHeight: number
  parallel: boolean
}
type TextRow = {
  lines: ProjectedLine[]
  inline: Interval
  axis: Interval
  axisCenter: number
  height: number
  glyphHeight: number
  parallel: boolean
}

type SentenceContext = {
  sentence: string
  context: string
  start: number
  end: number
  hasPrevious: boolean
  hasNext: boolean
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
    end,
    hasPrevious: current > 0,
    hasNext: current < sentences.length - 1
  }
}

/** OCR boxes use a bottom-left origin; pointer coordinates use a top-left origin. */
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
  let hit = lines.findIndex(
    (line) =>
      (line.quad?.length === 4 && pointInQuad(pointer, line.quad)) ||
      (line.quad?.length !== 4 &&
        pointer.x >= line.x &&
        pointer.x <= line.x + line.width &&
        pointer.y >= line.top &&
        pointer.y <= line.bottom)
  )
  if (hit < 0) {
    // OCR boxes can be a little narrower than the rendered glyphs. Pick the
    // closest nearby line, as Flow Translate does, before giving up on the hover.
    const nearby = lines
      .map((line, index) => ({
        index,
        dx: Math.max(line.x - pointer.x, 0, pointer.x - line.x - line.width) * aspectRatio,
        dy: Math.max(line.top - pointer.y, 0, pointer.y - line.bottom),
        height: line.height
      }))
      .filter(({ dx, dy, height }) => dx <= height * 0.9 && dy <= height * 0.5)
      .sort((a, b) => a.dx ** 2 + a.dy ** 2 - (b.dx ** 2 + b.dy ** 2))
    hit = nearby[0]?.index ?? -1
  }
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
    characterOffsetFromBoxes(target, pointer.x) ??
    characters.slice(0, approximateIndex).join('').length

  const rows = buildTextRows(lines, target, aspectRatio)
  const targetRow = rows.find((row) => row.lines.some((item) => item.line === target))
  if (!targetRow) return null
  const paragraphRows = [targetRow]
  for (const direction of [-1, 1]) {
    let edge = targetRow
    let referenceSpacing: number | undefined
    for (let count = 0; count < 40; count++) {
      const next = rows
        .filter(
          (row) =>
            !paragraphRows.includes(row) &&
            (row.axisCenter - edge.axisCenter) * direction > 0 &&
            intervalsOverlap(row.inline, edge.inline)
        )
        .sort(
          (a, b) =>
            Math.abs(a.axisCenter - edge.axisCenter) - Math.abs(b.axisCenter - edge.axisCenter)
        )[0]
      if (!next) break
      const heightRatio = next.height / targetRow.height
      const glyphHeightRatio = next.glyphHeight / targetRow.glyphHeight
      if (
        !next.parallel ||
        heightRatio < 0.7 ||
        heightRatio > 1.4 ||
        glyphHeightRatio < 0.7 ||
        glyphHeightRatio > 1.4
      )
        break
      const spacing = Math.abs(next.axisCenter - edge.axisCenter)
      if (referenceSpacing === undefined) {
        if (spacing >= targetRow.height * 3) break
        referenceSpacing = spacing
      } else if (Math.abs(spacing - referenceSpacing) > referenceSpacing * 0.25) {
        break
      }
      paragraphRows.push(next)
      edge = next
    }
  }
  paragraphRows.sort((a, b) => a.axisCenter - b.axisCenter)

  let text = ''
  let targetOffset = 0
  let targetStart = 0
  const lineRanges: { line: Line; start: number; end: number }[] = []
  for (const row of paragraphRows) {
    for (const { line } of row.lines) {
      if (text && line === row.lines[0].line && needsSpace(text, line.text)) text += ' '
      const start = text.length
      if (line === target) {
        targetStart = text.length
        targetOffset = text.length + characterOffset
      }
      text += line.text
      lineRanges.push({ line, start, end: text.length })
    }
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
  const targetLength = target.text.length
  const wordStart = Math.max(0, Math.min(targetLength, word.index - targetStart))
  const wordEnd = Math.max(
    wordStart,
    Math.min(targetLength, word.index + word.text.length - targetStart)
  )
  const targetText = target.text
  const targetTextVisualWidth = visualWidth(targetText, mixedCjkLatin)
  const wordLeft = visualWidth(targetText.slice(0, wordStart), mixedCjkLatin)
  const wordRight = visualWidth(targetText.slice(0, wordEnd), mixedCjkLatin)
  const measuredBounds = wordBoundsFromBoxes(target, wordStart, wordEnd)
  const bounds = measuredBounds ?? {
    x: target.x + (wordLeft / targetTextVisualWidth) * target.width,
    y: target.top,
    width: ((wordRight - wordLeft) / targetTextVisualWidth) * target.width,
    height: target.height
  }
  return {
    selection: {
      word: word.text,
      sentence: sentenceContext.sentence,
      context: sentenceContext.context
    },
    confidence: target.confidence,
    bounds,
    wordQuad: wordQuadFromBoxes(target, wordStart, wordEnd, bounds),
    contextBounds: {
      x: contextLeft,
      y: contextTop,
      width: contextRight - contextLeft,
      height: contextBottom - contextTop
    },
    hasBothAdjacentSentences: sentenceContext.hasPrevious && sentenceContext.hasNext
  }
}

function characterOffsetFromBoxes(line: Line, pointerX: number): number | null {
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

function wordBoundsFromBoxes(line: Line, start: number, end: number): OcrTextHit['bounds'] | null {
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

function wordQuadFromBoxes(
  line: Line,
  start: number,
  end: number,
  bounds: OcrTextHit['bounds']
): Point[] | undefined {
  if (line.quad?.length !== 4) return undefined
  const boxes = line.characters?.filter(
    (box) => box.start < end && box.start + box.length > start && box.width > 0 && box.height > 0
  )
  if (boxes?.length && boxes.every((box) => box.quad?.length === 4)) {
    const ordered = boxes.toSorted((a, b) => a.start - b.start)
    const first = ordered[0].quad!
    const last = ordered.at(-1)!.quad!
    return [first[0], last[1], last[2], first[3]]
  }

  // Vision exposes character rectangles but the line's four corners retain its angle.
  // Cut the line quadrilateral at the selected word's horizontal span.
  const [topLeft, topRight, bottomRight, bottomLeft] = line.quad
  const startFraction = Math.max(0, Math.min(1, (bounds.x - line.x) / line.width))
  const endFraction = Math.max(0, Math.min(1, (bounds.x + bounds.width - line.x) / line.width))
  const along = (from: Point, to: Point, fraction: number): Point => ({
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction
  })
  return [
    along(topLeft, topRight, startFraction),
    along(topLeft, topRight, endFraction),
    along(bottomLeft, bottomRight, endFraction),
    along(bottomLeft, bottomRight, startFraction)
  ]
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

function buildTextRows(lines: Line[], target: Line, aspectRatio: number): TextRow[] {
  const targetQuad = corners(target)
  const topEdge = {
    x: (targetQuad[1].x - targetQuad[0].x) * aspectRatio,
    y: targetQuad[1].y - targetQuad[0].y
  }
  const edgeLength = Math.hypot(topEdge.x, topEdge.y)
  const inline = edgeLength
    ? { x: topEdge.x / edgeLength, y: topEdge.y / edgeLength }
    : { x: 1, y: 0 }
  const axis = { x: -inline.y, y: inline.x }
  const project = (point: Point, direction: Point): number =>
    point.x * aspectRatio * direction.x + point.y * direction.y
  const interval = (quad: Point[], direction: Point): Interval => {
    const positions = quad.map((point) => project(point, direction))
    return { start: Math.min(...positions), end: Math.max(...positions) }
  }
  const anchorInline = interval(targetQuad, inline)
  const averageCharacterWidth =
    (anchorInline.end - anchorInline.start) /
    Math.max(1, Array.from(target.text).filter((character) => !/\s/u.test(character)).length)
  const projected = lines
    .map((line): ProjectedLine => {
      const quad = corners(line)
      const edge = {
        x: (quad[1].x - quad[0].x) * aspectRatio,
        y: quad[1].y - quad[0].y
      }
      const length = Math.hypot(edge.x, edge.y)
      const inlineRange = interval(quad, inline)
      const axisRange = interval(quad, axis)
      const glyphHeights = (line.characters ?? [])
        .filter((box) => box.width > 0 && box.height > 0)
        .map((box) => {
          const top = 1 - box.y - box.height
          const glyph = [
            { x: box.x, y: top },
            { x: box.x + box.width, y: top },
            { x: box.x + box.width, y: top + box.height },
            { x: box.x, y: top + box.height }
          ]
          const range = interval(glyph, axis)
          return range.end - range.start
        })
      return {
        line,
        inline: inlineRange,
        axis: axisRange,
        axisCenter: (axisRange.start + axisRange.end) / 2,
        height: axisRange.end - axisRange.start,
        glyphHeight: glyphHeights.length ? median(glyphHeights) : axisRange.end - axisRange.start,
        parallel:
          length > 0 && (edge.x * inline.x + edge.y * inline.y) / length >= Math.cos(Math.PI / 18)
      }
    })
    .filter((item) => item.height > 0)
    .sort((a, b) => a.axisCenter - b.axisCenter || a.inline.start - b.inline.start)

  const targetHeight = projected.find((item) => item.line === target)?.height
  if (!targetHeight) return []
  const columnGutters = findPersistentGutters(projected, targetHeight)
  const rows: TextRow[] = []
  for (const item of projected) {
    const row = rows.find(
      (candidate) =>
        candidate.parallel &&
        item.parallel &&
        intervalsOverlap(candidate.axis, item.axis) &&
        Math.abs(candidate.axisCenter - item.axisCenter) <= targetHeight * 0.1 &&
        item.height / targetHeight >= 0.7 &&
        item.height / targetHeight <= 1.4 &&
        item.glyphHeight / candidate.glyphHeight >= 0.7 &&
        item.glyphHeight / candidate.glyphHeight <= 1.4 &&
        intervalGap(candidate.inline, item.inline) < averageCharacterWidth * 2.5 &&
        !columnGutters.some(
          (position) =>
            (candidate.inline.end <= position && position <= item.inline.start) ||
            (item.inline.end <= position && position <= candidate.inline.start)
        )
    )
    if (row) {
      row.lines.push(item)
      row.inline = unionIntervals(row.inline, item.inline)
      row.axis = unionIntervals(row.axis, item.axis)
      row.axisCenter = (row.axis.start + row.axis.end) / 2
      row.height = row.axis.end - row.axis.start
      row.glyphHeight = median(row.lines.map((line) => line.glyphHeight))
    } else {
      rows.push({
        lines: [item],
        inline: item.inline,
        axis: item.axis,
        axisCenter: item.axisCenter,
        height: item.height,
        glyphHeight: item.glyphHeight,
        parallel: item.parallel
      })
    }
  }
  for (const row of rows) row.lines.sort((a, b) => a.inline.start - b.inline.start)
  return rows
}

function findPersistentGutters(lines: ProjectedLine[], rowHeight: number): number[] {
  const gaps = lines.flatMap((right) => {
    if (!right.parallel) return []
    const left = lines
      .filter(
        (candidate) =>
          candidate !== right &&
          candidate.parallel &&
          candidate.inline.end < right.inline.start &&
          intervalsOverlap(candidate.axis, right.axis) &&
          Math.abs(candidate.axisCenter - right.axisCenter) <= rowHeight * 0.1
      )
      .sort((a, b) => b.inline.end - a.inline.end)[0]
    if (!left) return []
    return [
      {
        inlineCenter: (left.inline.end + right.inline.start) / 2,
        axisCenter: (left.axisCenter + right.axisCenter) / 2
      }
    ]
  })
  return gaps
    .filter((gap) =>
      gaps.some(
        (other) =>
          Math.abs(other.inlineCenter - gap.inlineCenter) <= rowHeight * 1.25 &&
          Math.abs(other.axisCenter - gap.axisCenter) >= rowHeight * 0.75
      )
    )
    .map((gap) => gap.inlineCenter)
}

function corners(line: Line): Point[] {
  if (line.quad?.length === 4) return line.quad
  return [
    { x: line.x, y: line.top },
    { x: line.x + line.width, y: line.top },
    { x: line.x + line.width, y: line.bottom },
    { x: line.x, y: line.bottom }
  ]
}

function pointInQuad(point: Point, quad: Point[]): boolean {
  let sign = 0
  for (let index = 0; index < 4; index++) {
    const start = quad[index]
    const end = quad[(index + 1) % 4]
    const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x)
    if (cross === 0) continue
    const nextSign = Math.sign(cross)
    if (sign && sign !== nextSign) return false
    sign = nextSign
  }
  return true
}

function intervalsOverlap(first: Interval, second: Interval): boolean {
  return Math.min(first.end, second.end) > Math.max(first.start, second.start)
}

function intervalGap(first: Interval, second: Interval): number {
  return Math.max(first.start - second.end, second.start - first.end)
}

function unionIntervals(first: Interval, second: Interval): Interval {
  return { start: Math.min(first.start, second.start), end: Math.max(first.end, second.end) }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
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
