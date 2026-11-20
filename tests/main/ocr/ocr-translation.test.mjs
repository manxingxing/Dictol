import assert from 'node:assert/strict'
import { test } from 'node:test'
import { screenshotTranslationText } from '../../../src/main/ocr/ocr-translation.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function line(text, x, top, width = 0.4, height = 0.08) {
  return { text, x, y: 1 - top - height, width, height }
}

test('joins wrapped CJK text and punctuation without adding spaces', () => {
  const result = screenshotTranslationText([
    line('这是第一行，', 0.05, 0.1),
    line('这是第二行。', 0.05, 0.2),
    line('次の行', 0.05, 0.3)
  ])
  assert.equal(result, '这是第一行，这是第二行。次の行')
})

test('preserves spaces for English and mixed-script text', () => {
  const result = screenshotTranslationText([
    line('A useful', 0.05, 0.1),
    line('example for', 0.05, 0.2),
    line('中文', 0.05, 0.3),
    line('OCR', 0.05, 0.4)
  ])
  assert.equal(result, 'A useful example for 中文 OCR')
})

test('joins adjacent OCR fragments while preserving paragraph boundaries', () => {
  const result = screenshotTranslationText([
    line('中文', 0.05, 0.1, 0.18),
    line('文字', 0.24, 0.1, 0.18),
    line('下一段', 0.05, 0.3)
  ])
  assert.equal(result, '中文文字\n下一段')
})

test('handles supplementary CJK characters at fragment boundaries', () => {
  const result = screenshotTranslationText([
    line('漢𠀀', 0.05, 0.1, 0.18),
    line('中文', 0.24, 0.1, 0.18),
    line('𠀀文', 0.05, 0.2)
  ])
  assert.equal(result, '漢𠀀中文𠀀文')
})

test('keeps a visible gap between separate CJK fragments on the same row', () => {
  const result = screenshotTranslationText([
    line('中文', 0.05, 0.1, 0.12),
    line('日文', 0.5, 0.1, 0.12)
  ])
  assert.equal(result, '中文 日文')
})

test('reads two-line columns in column order', () => {
  const result = screenshotTranslationText([
    line('Left first.', 0.05, 0.1, 0.25),
    line('Right first.', 0.55, 0.1, 0.25),
    line('Left second.', 0.05, 0.2, 0.25),
    line('Right second.', 0.55, 0.2, 0.25)
  ])
  assert.equal(result, 'Left first. Left second.\nRight first. Right second.')
})

test('does not classify fragments of a single row as columns', () => {
  const result = screenshotTranslationText([
    line('One', 0.05, 0.1, 0.1),
    line('row', 0.2, 0.1, 0.1),
    line('with', 0.6, 0.1, 0.1),
    line('fragments', 0.75, 0.1, 0.1)
  ])
  assert.equal(result, 'One row with fragments')
})
