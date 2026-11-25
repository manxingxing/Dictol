/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// Compare historical lookup positioning with isolated real Electron windows.
const { app, screen } = require('electron')
const { execFileSync } = require('node:child_process')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../..')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
app.setPath('userData', path.join(os.tmpdir(), `dictol-history-geometry-${process.pid}`))
app.on('window-all-closed', (event) => event.preventDefault())

async function load(ref, file, dependencies = {}) {
  const source = execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' })
  const output = await esbuild.transform(source, { loader: 'ts', format: 'cjs' })
  const compiled = new Module(path.join(root, file), module)
  compiled.require = id => dependencies[id] ?? (id === 'electron' || id.startsWith('node:') ? require(id) : {})
  compiled._compile(output.code, path.join(root, file))
  return compiled.exports
}

async function measure(name, ref, forceHide, animate) {
  const position = await load(ref, 'src/main/lib/selection-position.ts')
  const { WebContentsViewManager } = await load(ref, 'src/main/web-contents-view-manager.ts')
  const { WindowManager } = await load(ref, 'src/main/window-manager.ts', {
    '../shared/selection-explanation': await load(ref, 'src/shared/selection-explanation.ts'),
    '../shared/selection-toolbar': await load(ref, 'src/shared/selection-toolbar.ts'),
    '../shared/translation': await load(ref, 'src/shared/translation.ts'),
    '../shared/window-chrome': await load(ref, 'src/shared/window-chrome.ts'),
    './web-contents-view-manager': { WebContentsViewManager },
    './entry-assets': { DICTIONARY_SESSION_PARTITION: 'geometry-history' },
    './output-path': { resolvePreloadPath: () => undefined },
    './selection-window-behavior': { applySelectionWindowBehavior: () => {} }
  })
  const { SelectionExplanationController } = await load(ref, 'src/main/controller/selection-explanation.ts', {
    './base-controller': await load(ref, 'src/main/controller/base-controller.ts'),
    '../lib/selection-position': position,
    '../output-path': { resolveRendererUrl: () => 'data:text/html,<body>Lookup history diagnostic</body>' },
    '../selection-window-behavior': { hideSelectionWindow: window => window?.hide() }
  })
  const manager = new WindowManager()
  const controller = new SelectionExplanationController({ windowManager: manager })
  controller.configureExplanationView = () => {}
  const window = controller.initializeExplanationWindow()
  await new Promise(resolve => window.webContents.once('did-finish-load', resolve))
  const samples = []
  let setBoundsCount = 0
  let resizeCount = 0
  const setBounds = window.setBounds.bind(window)
  window.setBounds = (...args) => { setBoundsCount++; return setBounds(...args) }
  window.on('resize', () => resizeCount++)
  for (let i = 0; i < 12; i++) {
    setBoundsCount = 0
    resizeCount = 0
    controller.prepareForOcrCapture()
    if (forceHide) window.hide()
    const x = 500 + (i % 2) * 80
    const anchor = name === 'before-animation'
      ? { centerX: x, top: 100, bottom: 100, gap: 16, posLevel: 0 }
      : position.createWordAnchor({ x, y: 100, width: 60, height: 30 })
    controller.setAnchor(anchor, { animate })
    const hiddenBeforePosition = !window.isVisible()
    controller.positionExplanation(window)
    window.showInactive()
    await wait(280)
    samples.push({ hiddenBeforePosition, width: window.getBounds().width, remembered: controller.preferredExplanationSize.width, setBoundsCount, resizeCount })
  }
  console.log(JSON.stringify({ name, samples }))
  window.destroy()
}

app.whenReady().then(async () => {
  console.log(JSON.stringify({ electron: process.versions.electron, scales: screen.getAllDisplays().map(display => display.scaleFactor) }))
  await measure('before-animation', '957af8e^', false, false)
  await measure('animation-added', '957af8e', false, true)
  await measure('animation-added-force-hide', '957af8e', true, true)
  await measure('animation-added-disabled', '957af8e', false, false)
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
