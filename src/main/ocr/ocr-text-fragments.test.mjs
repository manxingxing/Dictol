import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectOcrTextHit } from './ocr-text.ts'

test('separates neighboring English words detected as distinct boxes', () => {
  const observations = [
    { text: 'Hello', x: 0.05, y: 0.4, width: 0.2, height: 0.1 },
    { text: 'world', x: 0.28, y: 0.4, width: 0.2, height: 0.1 }
  ]
  const hit = selectOcrTextHit(observations, { x: 0.33, y: 0.55 }, 2)
  assert.equal(hit?.selection.word, 'world')
  assert.equal(hit?.selection.context, 'Hello world')
})

test('keeps nearby fragments of one word together', () => {
  const observations = [
    { text: 'exam', x: 0.05, y: 0.4, width: 0.16, height: 0.1 },
    { text: 'ple', x: 0.212, y: 0.4, width: 0.12, height: 0.1 }
  ]
  const hit = selectOcrTextHit(observations, { x: 0.25, y: 0.55 }, 2)
  assert.equal(hit?.selection.word, 'example')
  assert.equal(hit?.selection.context, 'example')
  assert.ok(Math.abs(hit.bounds.x - 0.05) < 1e-9)
  assert.ok(Math.abs(hit.bounds.width - 0.282) < 1e-9)
})

test('does not insert spaces between neighboring Chinese fragments', () => {
  const observations = [
    { text: '中文', x: 0.05, y: 0.4, width: 0.2, height: 0.1 },
    { text: '文字', x: 0.26, y: 0.4, width: 0.2, height: 0.1 }
  ]
  const hit = selectOcrTextHit(observations, { x: 0.31, y: 0.55 }, 2)
  assert.equal(hit?.selection.context, '中文文字')
})
