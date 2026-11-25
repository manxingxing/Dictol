/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function setup(visible = true, size = { width: 520, height: 600 }, measurementOffset = 0) {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/main/controller/selection-explanation.ts'),
    'utf8'
  )
  const output = await esbuild.transform(source, { loader: 'ts', format: 'cjs' })
  const sizeInputs = []
  const compiled = new Module(__filename, module)
  compiled.require = (id) => {
    if (id === './base-controller')
      return {
        BaseController: class {
          constructor(runtime) {
            this.runtime = runtime
          }
        }
      }
    if (id === '../lib/selection-position')
      return {
        createCursorAnchor: () => ({ x: 0, y: 0 }),
        fitExplanationNearSelection: (anchor, size) => {
          sizeInputs.push({ width: size.width, height: size.height })
          return { ...anchor, width: size.width, height: size.height }
        }
      }
    return {}
  }
  compiled._compile(output.code, __filename)
  let bounds = { x: 0, y: 0, ...size, width: size.width + measurementOffset }
  const positions = []
  const window = {
    isVisible: () => visible,
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    getSize: () => [bounds.width, bounds.height],
    setBounds: (next) => {
      bounds = { ...next, width: next.width + measurementOffset }
      positions.push({ ...bounds })
      controller.rememberExplanationSize(window)
    }
  }
  const controller = new compiled.exports.SelectionExplanationController({
    windowManager: {
      isSelectionExplanationPinned: () => false
    }
  })
  controller.preferredExplanationSize = { ...size }
  return {
    controller,
    window,
    positions,
    sizeInputs,
    getBounds: () => bounds,
    resize: (width, height) => {
      bounds = { ...bounds, width: width + measurementOffset, height }
      controller.rememberExplanationSize(window)
    }
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('visible window moves smoothly and redirects to the latest anchor', async () => {
  const { controller, window, positions, getBounds } = await setup()
  controller.setAnchor({ x: 300, y: 400 })
  controller.positionExplanation(window)
  assert.equal(getBounds().x, 0)
  await wait(70)
  assert.ok(getBounds().x > 0 && getBounds().x < 300)
  controller.setAnchor({ x: 100, y: 150 })
  controller.positionExplanation(window)
  await wait(300)
  assert.deepEqual(getBounds(), { x: 100, y: 150, width: 520, height: 600 })
  assert.ok(positions.length > 3)
})

test('hidden window is positioned immediately and pinning cancels movement', async () => {
  const hidden = await setup(false)
  hidden.controller.setAnchor({ x: 300, y: 400 })
  hidden.controller.positionExplanation(hidden.window)
  assert.equal(hidden.getBounds().x, 300)

  const visible = await setup()
  visible.controller.setAnchor({ x: 300, y: 400 })
  visible.controller.positionExplanation(visible.window)
  await wait(50)
  visible.controller.setPinned(true)
  const stopped = visible.getBounds().x
  await wait(250)
  assert.equal(visible.getBounds().x, stopped)
})

test('selection lookup positions a visible window immediately', async () => {
  const { controller, window, getBounds } = await setup()
  controller.setAnchor({ x: 300, y: 400 }, { animate: false })
  controller.positionExplanation(window)
  assert.equal(getBounds().x, 300)
  assert.equal(getBounds().y, 400)
})

test('a mode switch at the same position still applies its remembered size', async () => {
  const state = await setup()
  state.controller.setAnchor({ x: 0, y: 0 })
  state.controller.explanationPayload = { mode: 'ocr-ai' }
  state.controller.positionExplanation(state.window)
  assert.deepEqual(state.getBounds(), { x: 0, y: 0, width: 520, height: 320 })
})

test('dictionary and OCR AI modes remember their user-selected dimensions independently', async () => {
  const state = await setup(false, { width: 713, height: 427 })
  state.controller.explanationPayload = { mode: 'ocr-ai' }
  state.controller.positionExplanation(state.window)
  assert.deepEqual(state.sizeInputs.at(-1), { width: 520, height: 320 })
  state.resize(811, 509)
  for (let i = 0; i < 5; i++) {
    state.controller.explanationPayload = { mode: 'dictionary' }
    state.controller.setAnchor({ x: i * 20, y: i * 30 })
    state.controller.positionExplanation(state.window)
    assert.equal(state.getBounds().width, 713)
    assert.equal(state.getBounds().height, 427)

    state.controller.explanationPayload = { mode: 'ocr-ai' }
    state.controller.positionExplanation(state.window)
    assert.equal(state.getBounds().width, 811)
    assert.equal(state.getBounds().height, 509)
  }
})

test('movement animation preserves a manual resize while it is running', async () => {
  const state = await setup(true, { width: 713, height: 427 })
  state.controller.setAnchor({ x: 300, y: 400 })
  state.controller.positionExplanation(state.window)
  await wait(50)
  const { x, y } = state.getBounds()
  state.resize(811, 509)
  await wait(300)
  assert.deepEqual(state.getBounds(), { x, y, width: 811, height: 509 })
})

test('reported bounds cannot accumulate into the remembered size during repeated positioning', async () => {
  const state = await setup(false, { width: 520, height: 600 }, 1)
  for (let i = 0; i < 20; i++) {
    state.controller.setAnchor({ x: i * 10, y: i * 10 }, { animate: false })
    state.controller.positionExplanation(state.window)
    // Late and duplicate programmatic notifications must also be ignored.
    state.controller.rememberExplanationSize(state.window)
    state.controller.rememberExplanationSize(state.window)
    assert.equal(state.getBounds().width, 521)
    assert.deepEqual(state.controller.preferredExplanationSize, { width: 520, height: 600 })
    assert.deepEqual(state.sizeInputs.at(-1), { width: 520, height: 600 })
  }
  state.resize(713, 427)
  const remembered = { ...state.controller.preferredExplanationSize }
  state.controller.setAnchor({ x: 600, y: 400 })
  state.window.isVisible = () => true
  state.controller.positionExplanation(state.window)
  await wait(300)
  for (let i = 0; i < 20; i++) {
    state.controller.setAnchor({ x: i * 10, y: i * 10 }, { animate: false })
    state.controller.positionExplanation(state.window)
    assert.deepEqual(state.controller.preferredExplanationSize, remembered)
    assert.equal(state.getBounds().width, remembered.width + 1)
    assert.equal(state.getBounds().height, remembered.height)
  }
})
