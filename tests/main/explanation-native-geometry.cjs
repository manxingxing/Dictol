/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// Run with Electron: electron tests/main/explanation-native-geometry.cjs
const { app, screen } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')

app.setPath('userData', path.join(os.tmpdir(), `dictol-geometry-${process.pid}`))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const resizeTrace = []
app.on('window-all-closed', (event) => event.preventDefault())

async function loadTs(file, dependencies = {}) {
  const filename = path.resolve(__dirname, '../..', file)
  const output = await esbuild.transform(fs.readFileSync(filename, 'utf8'), {
    loader: 'ts',
    format: 'cjs'
  })
  const compiled = new Module(filename, module)
  compiled.require = (id) =>
    dependencies[id] ?? (id === 'electron' || id.startsWith('node:') ? require(id) : {})
  compiled._compile(output.code, filename)
  return compiled.exports
}

app
  .whenReady()
  .then(async () => {
    const position = await loadTs('src/main/lib/selection-position.ts')
    const { WebContentsViewManager } = await loadTs('src/main/web-contents-view-manager.ts')
    const { WindowManager } = await loadTs('src/main/window-manager.ts', {
      '../shared/selection-explanation': await loadTs('src/shared/selection-explanation.ts'),
      '../shared/selection-toolbar': await loadTs('src/shared/selection-toolbar.ts'),
      '../shared/translation': await loadTs('src/shared/translation.ts'),
      '../shared/window-chrome': await loadTs('src/shared/window-chrome.ts'),
      './web-contents-view-manager': { WebContentsViewManager },
      './output-path': { resolvePreloadPath: () => undefined },
      './entry-assets': { DICTIONARY_SESSION_PARTITION: 'geometry-test' },
      './selection-window-behavior': {
        applySelectionWindowBehavior: (window) => window.setAlwaysOnTop(true)
      }
    })
    const { SelectionExplanationController } = await loadTs(
      'src/main/controller/selection-explanation.ts',
      {
        './base-controller': await loadTs('src/main/controller/base-controller.ts'),
        '../lib/selection-position': position,
        '../output-path': {
          resolveRendererUrl: () =>
            'data:text/html,<body>Dictol lookup positioning regression</body>'
        }
      }
    )
    const manager = new WindowManager()
    const controller = new SelectionExplanationController({ windowManager: manager })
    let settingBounds = false
    const remember = controller.rememberExplanationSize.bind(controller)
    controller.rememberExplanationSize = (window) => {
      const trace = {
        settingBounds,
        measured: window.getSize(),
        applied: controller.appliedExplanationSize,
        before: controller.preferredExplanationSize
      }
      remember(window)
      trace.after = controller.preferredExplanationSize
      if (resizeTrace.length < 12) resizeTrace.push(trace)
    }
    controller.configureExplanationView = () => {}
    const window = controller.initializeExplanationWindow()
    const setBounds = window.setBounds.bind(window)
    window.setBounds = (...args) => {
      settingBounds = true
      try {
        return setBounds(...args)
      } finally {
        settingBounds = false
      }
    }
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
    window.showInactive()
    console.log(
      JSON.stringify({
        electron: process.versions.electron,
        displays: screen
          .getAllDisplays()
          .map(({ bounds, scaleFactor }) => ({ bounds, scaleFactor }))
      })
    )

    let recreatedSize
    const expectedSizes = new Map([
      ['dictionary', { width: 520, height: 600 }],
      ['ocr-ai', { width: 520, height: 320 }]
    ])
    const rememberedSize = (mode) =>
      mode === 'ocr-ai' ? controller.preferredOcrAiSize : controller.preferredExplanationSize
    for (const [mode, size, resize] of [
      ['dictionary', { width: 520, height: 600 }, false],
      ['ocr-ai', { width: 520, height: 320 }, false],
      ['dictionary', { width: 713, height: 427 }, true],
      ['ocr-ai', { width: 811, height: 509 }, true],
      ['dictionary', { width: 713, height: 427 }, false]
    ]) {
      controller.explanationPayload = { mode }
      if (resize) {
        // Exercise the real resize listener with an explicit user-selected size.
        window.setSize(size.width, size.height)
        const [width, height] = window.getSize()
        expectedSizes.set(mode, { width, height })
      }
      assert.deepEqual(rememberedSize(mode), expectedSizes.get(mode))
      const sizes = []
      const settledSizes = new Map()
      const sample = () => {
        const { width, height } = window.getBounds()
        sizes.push({ width, height })
      }
      window.on('resize', sample)
      for (let i = 0; i < 12; i++) {
        controller.setAnchor(
          position.createWordAnchor({ x: 500 + (i % 2) * 80, y: 100, width: 60, height: 30 })
        )
        controller.positionExplanation(window)
        await wait(280)
        sample()
        assert.deepEqual(rememberedSize(mode), expectedSizes.get(mode))
        const measured = sizes.at(-1)
        // Fractional scaling reports slightly different sizes at different origins.
        // Returning to the same target must never accumulate those differences.
        if (settledSizes.has(i % 2)) assert.deepEqual(measured, settledSizes.get(i % 2))
        else settledSizes.set(i % 2, measured)
      }
      window.off('resize', sample)
      recreatedSize = settledSizes.get(0)
      console.log(
        JSON.stringify({
          requested: size,
          remembered: rememberedSize(mode),
          mode,
          settled: [...settledSizes.values()],
          lookups: 12,
          samples: sizes.length,
          noAccumulation: true
        })
      )
    }

    window.hide()
    assert.equal(manager.createSelectionExplanationWindow(), window)
    window.destroy()
    const recreated = controller.initializeExplanationWindow()
    await new Promise((resolve) => recreated.webContents.once('did-finish-load', resolve))
    assert.deepEqual(controller.preferredExplanationSize, expectedSizes.get('dictionary'))
    assert.deepEqual(controller.preferredOcrAiSize, expectedSizes.get('ocr-ai'))
    controller.setAnchor(position.createWordAnchor({ x: 500, y: 100, width: 60, height: 30 }))
    controller.positionExplanation(recreated)
    const { width, height } = recreated.getBounds()
    assert.deepEqual({ width, height }, recreatedSize)
    recreated.destroy()
    console.log(
      'PASS: real lookup positioning preserves size across repeated animation, user size changes, hide/show and window recreation'
    )
    app.quit()
  })
  .catch((error) => {
    console.error(JSON.stringify({ resizeTrace }))
    console.error(error)
    app.exit(1)
  })
