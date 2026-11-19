/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function loadPosition(workArea, platform = 'darwin') {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/main/lib/selection-position.ts'),
    'utf8'
  )
  const output = await esbuild.transform(source, {
    loader: 'ts',
    format: 'cjs',
    define: { 'process.platform': JSON.stringify(platform) }
  })
  const compiled = new Module(__filename, module)
  compiled.require = () => ({
    screen: {
      getDisplayNearestPoint: () => ({ workArea }),
      getCursorScreenPoint: () => ({ x: 40, y: 50 }),
      screenToDipPoint: ({ x, y }) => ({ x: x / 2, y: y / 2 })
    }
  })
  compiled._compile(output.code, __filename)
  return compiled.exports
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

test('word bounds are avoided near every screen edge', async () => {
  const { createWordAnchor, fitExplanationNearSelection } = await loadPosition({
    x: -1200,
    y: 0,
    width: 1200,
    height: 800
  })
  const words = [
    { x: -800, y: 100, width: 100, height: 30 },
    { x: -800, y: 740, width: 100, height: 30 },
    { x: -1190, y: 380, width: 100, height: 30 },
    { x: -110, y: 380, width: 100, height: 30 }
  ]
  for (const word of words) {
    const result = fitExplanationNearSelection(createWordAnchor(word), { width: 520, height: 600 })
    assert.equal(overlaps(result, word), false, JSON.stringify({ word, result }))
    assert.ok(result.x >= -1188 && result.x + result.width <= -12)
    assert.ok(result.y >= 12 && result.y + result.height <= 788)
  }
})

test('word and selection bounds use the same positioning after coordinate conversion', async () => {
  const { createWordAnchor, toDisplayAnchor, fitExplanationNearSelection } = await loadPosition(
    { x: 0, y: 0, width: 1200, height: 800 },
    'win32'
  )
  const selection = {
    posLevel: 3,
    startTop: { x: 400, y: 200 },
    startBottom: { x: 400, y: 240 },
    endTop: { x: 800, y: 200 },
    endBottom: { x: 800, y: 240 }
  }
  const anchor = toDisplayAnchor({ selection })
  assert.deepEqual(anchor.avoidanceBounds, { x: 200, y: 100, width: 200, height: 20 })
  const result = fitExplanationNearSelection(anchor, { width: 520, height: 600 })
  assert.equal(overlaps(result, anchor.avoidanceBounds), false)
  assert.deepEqual(
    result,
    fitExplanationNearSelection(createWordAnchor(anchor.avoidanceBounds), {
      width: 520,
      height: 600
    })
  )
})

test('multiline selection avoids the full span and missing positions use the cursor', async () => {
  const { toDisplayAnchor, fitExplanationNearSelection } = await loadPosition({
    x: 0,
    y: 0,
    width: 1200,
    height: 800
  })
  const selection = {
    posLevel: 3,
    startTop: { x: 400, y: 600 },
    startBottom: { x: 400, y: 620 },
    endTop: { x: 200, y: 650 },
    endBottom: { x: 200, y: 670 }
  }
  const anchor = toDisplayAnchor({ selection })
  assert.deepEqual(anchor.avoidanceBounds, { x: 0, y: 600, width: 1200, height: 70 })
  const result = fitExplanationNearSelection(anchor, { width: 520, height: 400 })
  assert.equal(overlaps(result, anchor.avoidanceBounds), false)
  const fallback = toDisplayAnchor({ selection: { ...selection, posLevel: 0 } })
  assert.equal(fallback.avoidanceBounds, undefined)
  assert.equal(fallback.centerX, 40)
  assert.equal(fallback.bottom, 50)
  const mouseFallback = toDisplayAnchor({
    selection: { ...selection, posLevel: 2, mousePosEnd: { x: 80, y: 90 } }
  })
  assert.equal(mouseFallback.avoidanceBounds, undefined)
  assert.equal(mouseFallback.centerX, 80)
  assert.equal(mouseFallback.bottom, 90)
  const incomplete = toDisplayAnchor({
    selection: {
      ...selection,
      startTop: { x: -99999, y: -99999 },
      mousePosEnd: { x: 80, y: 90 }
    }
  })
  assert.equal(incomplete.avoidanceBounds, undefined)
  assert.equal(incomplete.centerX, 80)
  assert.equal(incomplete.posLevel, 1)
})

test('chooses the least overlap when no side has enough room', async () => {
  const { createWordAnchor, fitExplanationNearSelection } = await loadPosition({
    x: 0,
    y: 0,
    width: 500,
    height: 400
  })
  const word = { x: 200, y: 175, width: 100, height: 50 }
  const result = fitExplanationNearSelection(createWordAnchor(word), { width: 520, height: 600 })
  assert.deepEqual(result, { x: 12, y: 12, width: 476, height: 376 })
})

test('mouse fallback stays above the cursor when there is not enough room below', async () => {
  const { toDisplayAnchor, fitExplanationNearSelection } = await loadPosition({
    x: 0,
    y: 30,
    width: 2560,
    height: 1334
  })
  const anchor = toDisplayAnchor({
    selection: { posLevel: 1, mousePosEnd: { x: 1430.37890625, y: 835.05859375 } }
  })
  const result = fitExplanationNearSelection(anchor, { width: 520, height: 600 })
  assert.deepEqual(result, { x: 1442, y: 219, width: 520, height: 600 })
  assert.ok(result.y + result.height < anchor.top)

  const upperAnchor = toDisplayAnchor({
    selection: { posLevel: 1, mousePosEnd: { x: 1430, y: 200 } }
  })
  const upperResult = fitExplanationNearSelection(upperAnchor, { width: 520, height: 600 })
  assert.equal(upperResult.y, 216)
})
