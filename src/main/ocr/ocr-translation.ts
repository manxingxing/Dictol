import type { OcrObservation } from './ocr-text'

/** Assemble OCR line boxes into text for a user-selected screen region. */
export function screenshotTranslationText(observations: OcrObservation[]): string {
  const lines = observations
    .filter((line) => line.text.trim() && line.width > 0 && line.height > 0)
    .map((line) => ({
      text: line.text.trim(),
      x: line.x,
      right: line.x + line.width,
      top: 1 - line.y - line.height,
      bottom: 1 - line.y,
      height: line.height
    }))
    .sort((a, b) => a.top - b.top || a.x - b.x)

  if (!lines.length) return ''

  // A selected region may contain two PDF columns. Only split when both sides
  // have several lines, a real gutter, and overlap vertically.
  const byCenter = [...lines].sort((a, b) => (a.x + a.right) / 2 - (b.x + b.right) / 2)
  let split = -1
  let largestGap = 0
  for (let index = 3; index <= byCenter.length - 3; index++) {
    const left = byCenter.slice(0, index)
    const right = byCenter.slice(index)
    const gutter =
      Math.min(...right.map((line) => line.x)) - Math.max(...left.map((line) => line.right))
    const overlap =
      Math.min(
        Math.max(...left.map((line) => line.bottom)),
        Math.max(...right.map((line) => line.bottom))
      ) -
      Math.max(
        Math.min(...left.map((line) => line.top)),
        Math.min(...right.map((line) => line.top))
      )
    if (gutter > 0.04 && gutter > largestGap && overlap > 0.1) {
      largestGap = gutter
      split = index
    }
  }
  const text =
    split > 0
      ? [byCenter.slice(0, split), byCenter.slice(split)]
          .map((column) => joinLines(column))
          .filter(Boolean)
          .join('\n\n')
      : joinLines(lines)
  return normalizeScreenshotTranslationLineBreaks(text)
}

/** Join wrapped lines while retaining a single break between paragraphs or columns. */
function normalizeScreenshotTranslationLineBreaks(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/(?:[ \t]*\n)+[ \t]*/g, (breaks) =>
      breaks.indexOf('\n') === breaks.lastIndexOf('\n') ? ' ' : '\n'
    )
}

/** Repair obvious missing spaces in long English OCR runs using the bundled lexicon. */
export function repairMergedEnglishWords(
  text: string,
  lookupRank: (word: string) => number | null
): string {
  const cache = new Map<string, number | null>()
  const rank = (word: string): number | null => {
    if (!cache.has(word)) cache.set(word, lookupRank(word))
    return cache.get(word) ?? null
  }
  return text.replace(/\b[a-z]{13,40}\b/gu, (word) => {
    if (rank(word) !== null) return word
    let best: { parts: string[]; score: number } | undefined
    const consider = (parts: string[]): void => {
      const limit = parts.length === 2 ? 1_000 : 5_000
      const ranks: number[] = []
      for (const part of parts) {
        const value = rank(part)
        if (value === null || value < 1 || value > limit) return
        ranks.push(value)
      }
      const score =
        ranks.reduce((sum, value) => sum + Math.log(value + 1), 0) + (parts.length - 1) * 2
      if (!best || score < best.score) best = { parts, score }
    }
    for (let first = 3; first <= word.length - 3; first++) {
      const head = word.slice(0, first)
      if (rank(head) === null) continue
      consider([head, word.slice(first)])
      for (let second = first + 3; second <= word.length - 3; second++) {
        consider([head, word.slice(first, second), word.slice(second)])
      }
    }
    return best?.parts.join(' ') ?? word
  })
}

function joinLines(
  lines: Array<{ text: string; x: number; top: number; bottom: number; height: number }>
): string {
  const ordered = [...lines].sort((a, b) => a.top - b.top || a.x - b.x)
  const rows: (typeof ordered)[] = []
  for (const line of ordered) {
    const row = rows.at(-1)
    if (
      row &&
      Math.abs((row[0].top + row[0].bottom) / 2 - (line.top + line.bottom) / 2) <
        Math.min(row[0].height, line.height) * 0.5
    ) {
      row.push(line)
    } else {
      rows.push([line])
    }
  }
  const assembled = rows.map((row) => ({
    text: row
      .sort((a, b) => a.x - b.x)
      .map((line) => line.text)
      .join(' '),
    top: Math.min(...row.map((line) => line.top)),
    bottom: Math.max(...row.map((line) => line.bottom)),
    height: Math.max(...row.map((line) => line.height))
  }))
  return assembled
    .map((row, index) => {
      if (index === 0) return row.text
      const previous = assembled[index - 1]
      const gap = row.top - previous.bottom
      const paragraphBreak = gap > Math.max(previous.height, row.height) * 0.65
      return `${paragraphBreak ? '\n\n' : '\n'}${row.text}`
    })
    .join('')
}
