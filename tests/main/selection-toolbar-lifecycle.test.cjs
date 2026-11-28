/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function loadController(file, platform, mocks) {
  const source = fs.readFileSync(path.join(__dirname, '../../src/main/controller', file), 'utf8')
  const output = await esbuild.transform(source, {
    loader: 'ts',
    format: 'cjs',
    define: { 'process.platform': JSON.stringify(platform) }
  })
  const compiled = new Module(__filename, module)
  compiled.require = (id) => {
    if (id === './base-controller') {
      return {
        BaseController: class {
          constructor(runtime) {
            this.runtime = runtime
          }
        }
      }
    }
    return mocks[id] ?? {}
  }
  compiled._compile(output.code, __filename)
  return compiled.exports
}

async function setup(platform) {
  let config = {
    featureFlags: { lookupWordOnSelection: true },
    shortcuts: {},
    selection: { excludedPrograms: [] }
  }
  const subscriptions = new Set()
  const subscribe = () => {
    const subscription = {}
    subscriptions.add(subscription)
    return () => subscriptions.delete(subscription)
  }
  const windows = []
  const ipcMain = new EventEmitter()
  ipcMain.handle = () => {}
  class TestNativeSelectionPanel extends EventEmitter {}
  const runtime = {
    mainWindow: { isDestroyed: () => false, webContents: { id: 1 } },
    appConfig: {
      load: () => config,
      save: (next) => {
        config = next
      }
    },
    restartInputServices: () => {},
    shortcutRegister: { isRegistered: () => false },
    selectionHookService: {
      getStatus: () => ({ running: true }),
      getCapabilities: () => ({ supported: true, limitation: null }),
      onSelection: () => {},
      onKeyDown: subscribe,
      onMouseWheel: subscribe,
      onMouseDown: subscribe
    },
    windowManager: {
      createSelectionToolbarWindow() {
        if (this.selectionToolbarWindow) return this.selectionToolbarWindow
        const window = platform === 'darwin' ? new TestNativeSelectionPanel() : new EventEmitter()
        const webContents = new EventEmitter()
        Object.assign(webContents, {
          id: 10 + windows.length,
          setWindowOpenHandler: () => {},
          send: (_channel, payload) => {
            window.payload = payload
          },
          isDestroyed: () => window.destroyed
        })
        Object.assign(window, {
          webContents,
          destroyed: false,
          visible: false,
          isDestroyed: () => window.destroyed,
          isVisible: () => window.visible,
          isFocused: () => false,
          getSize: () => [300, 44],
          setSize: () => {},
          setBounds: () => {},
          setIgnoreMouseEvents: () => {},
          setOpacity: () => {},
          hide: () => {
            window.visible = false
            window.emit('hide')
          },
          loadURL: () => Promise.resolve(),
          finishLoad: () => {
            if (!window.destroyed) webContents.emit('did-finish-load')
          },
          destroy: () => {
            window.destroyed = true
            window.visible = false
            window.emit('closed')
          }
        })
        window.once('closed', () => {
          this.selectionToolbarWindow = undefined
        })
        this.selectionToolbarWindow = window
        windows.push(window)
        return window
      }
    }
  }
  const { WordCaptureController } = await loadController('word-capture.ts', platform, {
    electron: { systemPreferences: { isTrustedAccessibilityClient: () => true } },
    '@dictol/ocr-native': { getPermissionStatus: () => 'granted' },
    '../../shared/ocr': { OCR_SUPPORTED: true }
  })
  const { SelectionToolbarController } = await loadController('selection-toolbar.ts', platform, {
    electron: {
      BrowserWindow: { getFocusedWindow: () => undefined },
      ipcMain
    },
    '../native-selection-panel': { NativeSelectionPanel: TestNativeSelectionPanel },
    '../output-path': { resolveRendererUrl: (name) => name },
    '../../shared/selection-toolbar': {
      getSelectionToolbarWindowSize: () => ({ width: 300, height: 44 })
    },
    '../selection-window-behavior': {
      showSelectionWindowInactive: (window) => {
        window.visible = true
      },
      hideSelectionWindow: (window) => window.hide()
    },
    '../lib/selection-position': {
      toDisplayAnchor: () => ({ x: 10, y: 20 }),
      fitNearSelection: () => ({ x: 10, y: 20, width: 300, height: 44 })
    }
  })
  const { SelectionExplanationAction } = await loadController(
    '../action/selection-explanation.ts',
    platform,
    {
      '../lib/selection-position': {
        createCursorAnchor: () => ({ centerX: 400, top: 250, bottom: 250, gap: 16, posLevel: 0 })
      }
    }
  )
  const explanation = new SelectionExplanationAction(runtime)
  explanation.prewarmExplanationWindow = () => {}
  runtime.actions = { explanation }
  const toolbar = new SelectionToolbarController(runtime, {
    isVisible: false,
    setOnVisibilityChange: () => {}
  })
  const settings = new WordCaptureController(runtime)
  const toggle = (enabled) => settings.setSelectionEnabled({ sender: { id: 1 } }, enabled)
  const select = () =>
    toolbar.handleSelection({
      source: 'selection',
      selection: { text: 'word', programName: 'Test' }
    })
  const show = (window) => {
    window.finishLoad()
    if (platform === 'win32')
      toolbar.handleToolbarRendered({ sender: window.webContents }, window.payload.requestId)
  }
  return {
    runtime,
    settings,
    explanation,
    toolbar,
    windows,
    subscriptions,
    ipcMain,
    toggle,
    select,
    show
  }
}

for (const platform of ['win32', 'darwin']) {
  for (const state of ['loading', 'visible', 'hidden']) {
    test(`${platform}: disable destroys ${state} toolbar; re-enable waits for a new selection`, async () => {
      const { runtime, toolbar, windows, subscriptions, toggle, select, show } =
        await setup(platform)
      select()
      const previous = windows[0]
      if (state !== 'loading') show(previous)
      if (state === 'hidden') toolbar.hideToolbar()
      try {
        assert.equal(toggle(false).ok, true)
        assert.equal(previous.isDestroyed(), true)
        assert.equal(previous.webContents.isDestroyed(), true)
        assert.equal(runtime.windowManager.selectionToolbarWindow, undefined)
        assert.equal(toolbar.toolbarLoaded, false)
        assert.equal(toolbar.toolbarWebContentsId, undefined)
        assert.equal(toolbar.currentCapture, undefined)
        assert.equal(toolbar.pendingToolbarCapture, undefined)
        assert.equal(toolbar.pendingToolbarRenderRequestId, undefined)
        assert.equal(toolbar.inactivityTimer, undefined)
        assert.equal(subscriptions.size, 0)

        assert.equal(toggle(true).ok, true)
        assert.equal(windows.length, 1)
        assert.equal(runtime.windowManager.selectionToolbarWindow, undefined)
        select()
        const recreated = windows[1]
        assert.notEqual(recreated.webContents.id, previous.webContents.id)
        assert.equal(toolbar.toolbarLoaded, false)
        previous.finishLoad()
        assert.equal(toolbar.toolbarLoaded, false)
        show(recreated)
        assert.equal(toolbar.toolbarLoaded, true)
        assert.equal(toolbar.toolbarVisible, true)
        assert.equal(recreated.payload.word, 'word')
        assert.equal(subscriptions.size, 3)
      } finally {
        toggle(false)
      }
    })
  }
}

test('toggling before first use never creates a toolbar window', async () => {
  const { toggle, windows } = await setup('win32')
  assert.equal(toggle(false).ok, true)
  assert.equal(toggle(true).ok, true)
  assert.equal(windows.length, 0)
})

test('main window lookup anchors the explanation to the cursor and dismisses the toolbar', async () => {
  const { runtime, explanation, toolbar, ipcMain, windows, select, show, toggle } =
    await setup('darwin')
  const { SelectionExplanationController } = await loadController(
    'selection-explanation.ts',
    'darwin',
    {
      electron: { ipcMain },
      '../../shared/selection-explanation': { SELECTION_EXPLANATION_MAX_WORD_LENGTH: 200 }
    }
  )
  const calls = []
  explanation.setAnchor = (anchor) => calls.push(anchor)
  explanation.showExplanation = async (word) => calls.push(word)
  toolbar.mount()
  new SelectionExplanationController(runtime).mount()
  try {
    select()
    show(windows[0])
    ipcMain.emit('selection-explanation:show-from-main', { sender: { id: 99 } }, 'foreign')
    assert.equal(windows[0].isVisible(), true)
    ipcMain.emit('selection-explanation:show-from-main', { sender: { id: 1 } }, ' lookup ')
    assert.deepEqual(calls, [
      { x: 10, y: 20 },
      { centerX: 400, top: 250, bottom: 250, gap: 16, posLevel: 0 },
      'lookup'
    ])
    assert.equal(windows[0].isVisible(), false)
  } finally {
    toggle(false)
  }
})

for (const selected of [true, false]) {
  test(`macOS native menu ${selected ? 'applies a selection' : 'dismisses'} after tracking ends`, async () => {
    const { runtime, toolbar, windows, toggle, select, show } = await setup('darwin')
    const calls = []
    runtime.appConfig.addExcludedProgram = (program) => calls.push(program)
    runtime.restartInputServices = () => calls.push('restart')
    try {
      select()
      const window = windows[0]
      show(window)
      window.on('hide', () => calls.push('hide'))
      window.showDisableSelectionMenu = (enabled) => {
        assert.equal(enabled, true)
        // A selection arriving during tracking must not change the menu's target.
        toolbar.currentCapture = { selection: { programName: 'Different app' } }
        calls.push('menu closed')
        return selected
      }
      toolbar.openNativeMenu({ sender: window.webContents })
      assert.deepEqual(
        calls,
        selected ? ['menu closed', 'Test', 'restart', 'hide'] : ['menu closed', 'hide']
      )
      assert.equal(toolbar.nativeMenuOpen, false)
    } finally {
      toggle(false)
    }
  })
}

test('failed setting update preserves the existing toolbar and restores the setting', async () => {
  const { runtime, toolbar, toggle, select, windows } = await setup('win32')
  select()
  let fail = true
  runtime.restartInputServices = () => {
    if (fail) {
      fail = false
      throw new Error('input service failed')
    }
  }
  const originalError = console.error
  console.error = () => {}
  try {
    assert.equal(toggle(false).ok, false)
    assert.equal(runtime.appConfig.load().featureFlags.lookupWordOnSelection, true)
    assert.equal(windows[0].isDestroyed(), false)
    assert.notEqual(toolbar.pendingToolbarCapture, undefined)
  } finally {
    console.error = originalError
    toggle(false)
  }
})
