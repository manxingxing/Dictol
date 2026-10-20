import assert from 'node:assert/strict'
import test from 'node:test'
import { selectOcrTextHit } from '../src/main/ocr-text.ts'

const image = { width: 742, height: 458 }
const line = (text, x, top, width, height = 24) => ({
  text,
  x: x / image.width,
  y: 1 - (top + height) / image.height,
  width: width / image.width,
  height: height / image.height
})

// Based on a two-column PDF where OCR splits the left target row at a style
// boundary and the next right-column row starts close to its right edge.
const observations = [
  line('ers. Generally speaking', 10, 60, 205, 28),
  line('customers have more', 209, 62, 191),
  line('power relative to vendors as their technological', 9, 88, 391),
  line('aptitude and product knowledge continue to', 9, 114, 391),
  line('increase.', 9, 140, 90),
  line('bution partnering are becoming more significant.', 414, 57, 326),
  line('On the other hand, in a developed market.', 454, 85, 286)
]

function hitAt(x, y, lines = observations) {
  return selectOcrTextHit(
    lines,
    { x: x / image.width, y: y / image.height },
    image.width / image.height
  )
}

test('left-column sentence joins its own OCR fragments without appending the right column', () => {
  const hit = hitAt(165, 74)
  assert.equal(hit?.selection.word, 'speaking')
  assert.equal(
    hit.selection.sentence,
    'Generally speaking customers have more power relative to vendors as their technological aptitude and product knowledge continue to increase.'
  )
})

test('right-column lookup does not pull text from the left column', () => {
  const hit = hitAt(500, 69)
  assert.equal(hit?.selection.word, 'partnering')
  assert.doesNotMatch(hit.selection.context, /Generally speaking|customers have more/u)
})

test('a repeated narrow gutter separates columns even when it is smaller than a word gap', () => {
  const narrowGutter = observations.map((item) => {
    if (item.text.startsWith('bution partnering')) return { ...item, x: 410 / image.width }
    if (item.text.startsWith('On the other hand')) return { ...item, x: 440 / image.width }
    return item
  })
  assert.equal(
    hitAt(165, 74, narrowGutter)?.selection.sentence,
    'Generally speaking customers have more power relative to vendors as their technological aptitude and product knowledge continue to increase.'
  )
})

test('a single neighboring-column row cannot be mistaken for a style fragment', () => {
  assert.equal(
    hitAt(165, 74, observations.slice(0, 6))?.selection.sentence,
    'Generally speaking customers have more power relative to vendors as their technological aptitude and product knowledge continue to increase.'
  )
})
