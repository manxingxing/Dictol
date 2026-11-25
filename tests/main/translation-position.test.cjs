/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function loadTs(file, dependencies, platform) {
  const filename = path.resolve(__dirname, '../..', file)
  const source = fs.readFileSync(filename, 'utf8')
  const output = await esbuild.transform(source, {
    loader: 'ts',
    format: 'cjs',
    define: { 'process.platform': JSON.stringify(platform) }
  })
  const compiled = new Module(filename, module)
  compiled.require = (id) => dependencies[id] ?? {}
  compiled._compile(output.code, filename)
  return compiled.exports
}

async function setup(platform = 'win32', scale = 1, workAreaX = 0) {
  const workArea = { x: workAreaX, y: 0, width: 1920, height: 1040 }
  let cursor = { x: workAreaX + 1000, y: 590 }
  let bounds
  const positions = []
  const screen = {
    getDisplayNearestPoint: () => ({ workArea }),
    getDisplayMatching: () => ({ workArea }),
    getCursorScreenPoint: () => ({ ...cursor }),
    screenToDipPoint: ({ x, y }) => ({ x: x / scale, y: y / scale })
  }
  const position = await loadTs(
    'src/main/lib/selection-position.ts',
    { electron: { screen } },
    platform
  )
  const translation = await loadTs('src/shared/translation.ts', {}, platform)
  const window = {
    webContents: {
      id: 1,
      on() {},
      setWindowOpenHandler() {}
    },
    on() {},
    loadURL: async () => {},
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => {
      bounds = { ...bounds, ...next }
      positions.push({ ...bounds })
    }
  }
  const { TranslationActions } = await loadTs(
    'src/main/action/translation.ts',
    {
      electron: { screen },
      '../../shared/translation': translation,
      '../lib/selection-position': position,
      '../output-path': { resolveRendererUrl: () => 'about:blank' }
    },
    platform
  )
  const point = (x, y) => ({ x: (workAreaX + x) * scale, y: y * scale })
  const selection = {
    text: 'Selected text spanning several lines. '.repeat(20),
    posLevel: 4,
    startTop: point(400, 100),
    startBottom: point(400, 120),
    endTop: point(1000, 600),
    endBottom: point(1000, 620),
    mousePosEnd: point(1000, 590)
  }
  const actions = new TranslationActions({
    windowManager: {
      createSelectionTranslationWindow: () => window,
      selectionTranslationWindow: window
    },
    selectionHookService: { getCurrentSelection: () => selection }
  })
  const { SelectionToolbarController } = await loadTs(
    'src/main/controller/selection-toolbar.ts',
    {
      '../lib/selection-position': position,
      '../../shared/translation': translation,
      './base-controller': { BaseController: class {} }
    },
    platform
  )
  const toolbar = new SelectionToolbarController({}, {}, actions)
  toolbar.acceptsToolbarSender = () => true
  toolbar.hideToolbar = () => {
    toolbar.currentCapture = undefined
  }
  const translateFromToolbar = () => {
    toolbar.currentCapture = { source: 'selection', selection }
    toolbar.anchor = position.toDisplayAnchor(toolbar.currentCapture)
    toolbar.translate({})
  }
  return {
    actions,
    selection,
    translateFromToolbar,
    workArea,
    positions,
    getBounds: () => bounds,
    setCursor: (point) => (cursor = point)
  }
}

for (const [platform, scale, workAreaX] of [
  ['win32', 1, 0],
  ['win32', 2, -1920],
  ['darwin', 1, 0],
  ['linux', 1, 0]
]) {
  test(`${platform} scale ${scale}: translation aligns with the selection left edge and bottom on display ${workAreaX}`, async () => {
    const state = await setup(platform, scale, workAreaX)
    state.translateFromToolbar()
    assert.equal(state.getBounds().x, workAreaX + 400)
    assert.equal(state.getBounds().y, 624)
    assert.equal(state.getBounds().height, 264)

    // Reversing the gesture does not change the selection's left edge or bottom.
    state.selection.mousePosEnd = { x: (workAreaX + 400) * scale, y: 110 * scale }
    state.translateFromToolbar()
    assert.equal(state.getBounds().x, workAreaX + 400)
    assert.equal(state.getBounds().y, 624)

    // Providers may also report the two selection endpoints in the opposite order.
    const { startTop, startBottom, endTop, endBottom } = state.selection
    Object.assign(state.selection, {
      startTop: endTop,
      startBottom: endBottom,
      endTop: startTop,
      endBottom: startBottom
    })
    state.translateFromToolbar()
    assert.equal(state.getBounds().x, workAreaX + 400)
    assert.equal(state.getBounds().y, 624)

    // A single-line selection follows the same rule.
    state.selection.text = 'short'
    state.selection.startTop = startTop
    state.selection.startBottom = startBottom
    state.selection.endTop = { x: (workAreaX + 500) * scale, y: 100 * scale }
    state.selection.endBottom = { x: (workAreaX + 500) * scale, y: 120 * scale }
    state.translateFromToolbar()
    assert.equal(state.getBounds().x, workAreaX + 400)
    assert.equal(state.getBounds().y, 124)
  })
}

test('translation shortcut also prefers available selection bounds to the cursor', async () => {
  const state = await setup()
  state.setCursor({ x: 800, y: 200 })
  state.actions.translateCurrentSelection()
  assert.equal(state.getBounds().x, 400)
  assert.equal(state.getBounds().y, 624)
})

for (const posLevel of [0, 1, 2]) {
  test(`position level ${posLevel} falls back to the current cursor for toolbar and shortcut translation`, async () => {
    const state = await setup()
    state.selection.posLevel = posLevel
    state.setCursor({ x: 800, y: 200 })
    state.translateFromToolbar()
    assert.equal(state.getBounds().x, 800)
    assert.equal(state.getBounds().y, 216)
    state.actions.translateCurrentSelection()
    assert.equal(state.getBounds().x, 800)
    assert.equal(state.getBounds().y, 216)
  })
}

test('incomplete selection bounds fall back to the cursor', async () => {
  const state = await setup()
  state.selection.startTop = { x: -99999, y: -99999 }
  state.setCursor({ x: 800, y: 200 })
  state.translateFromToolbar()
  assert.equal(state.getBounds().x, 800)
  assert.equal(state.getBounds().y, 216)
})

test('initial cursor placement is preserved until height updates fit the window to the screen', async () => {
  const state = await setup('win32', 2, -1920)
  state.selection.posLevel = 0
  state.setCursor({ x: -20, y: 1030 })
  state.translateFromToolbar()
  let bounds = state.getBounds()
  assert.deepEqual(bounds, { x: -20, y: 1046, width: 520, height: 264 })
  state.actions.resizeSelectionWindow(1, 2000)
  bounds = state.getBounds()
  assert.deepEqual(bounds, { x: -20, y: 268, width: 520, height: 760 })

  state.actions.togglePin()
  const count = state.positions.length
  state.translateFromToolbar()
  assert.equal(state.positions.length, count)
})

test('translation height changes move the window up only when its bottom would exceed the screen', async () => {
  const state = await setup()
  state.translateFromToolbar()
  const initial = state.getBounds()
  assert.deepEqual(initial, { x: 400, y: 624, width: 520, height: 264 })

  state.actions.resizeSelectionWindow(1, 380)
  assert.deepEqual(state.getBounds(), { ...initial, height: 380 })

  state.actions.resizeSelectionWindow(1, 700)
  assert.deepEqual(state.getBounds(), { ...initial, y: 328, height: 700 })

  // Shrinking keeps the adjusted position, as before.
  state.actions.resizeSelectionWindow(1, 280)
  assert.deepEqual(state.getBounds(), { ...initial, y: 328, height: 280 })

  // Height reports from an earlier translation must not affect the current one.
  state.actions.resizeSelectionWindow(0, 500)
  assert.deepEqual(state.getBounds(), { ...initial, y: 328, height: 280 })
})

test('selection placement is not moved or narrowed to fit the screen', async () => {
  const state = await setup()
  state.selection.startTop = { x: 1800, y: 1000 }
  state.selection.startBottom = { x: 1800, y: 1020 }
  state.selection.endTop = { x: 1900, y: 1000 }
  state.selection.endBottom = { x: 1900, y: 1020 }
  state.translateFromToolbar()
  assert.deepEqual(state.getBounds(), { x: 1800, y: 1024, width: 520, height: 264 })
})

test('direct translation without selection data uses the current cursor', async () => {
  const state = await setup()
  state.setCursor({ x: 700, y: 300 })
  state.actions.showSelection('text')
  assert.deepEqual(state.getBounds(), { x: 700, y: 316, width: 520, height: 264 })
})
