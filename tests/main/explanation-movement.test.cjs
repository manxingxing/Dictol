/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function setup(visible = true) {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/main/controller/selection-explanation.ts'),
    'utf8'
  )
  const output = await esbuild.transform(source, { loader: 'ts', format: 'cjs' })
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
        fitExplanationNearSelection: (anchor, size) => ({ ...anchor, ...size })
      }
    return {}
  }
  compiled._compile(output.code, __filename)
  let bounds = { x: 0, y: 0, width: 520, height: 600 }
  const positions = []
  const window = {
    isVisible: () => visible,
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => {
      bounds = next
      positions.push({ ...next })
    }
  }
  const controller = new compiled.exports.SelectionExplanationController({
    windowManager: { isSelectionExplanationPinned: () => false }
  })
  return { controller, window, positions, getBounds: () => bounds }
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
