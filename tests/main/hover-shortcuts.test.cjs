/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { test } = require('node:test')
const esbuild = require('esbuild')

const root = path.resolve(__dirname, '../..')

function compile(code, mocks) {
  const compiled = new Module(__filename, module)
  compiled.filename = __filename
  compiled.paths = module.paths
  if (mocks) compiled.require = (id) => mocks[id] ?? {}
  compiled._compile(code, __filename)
  return compiled.exports
}

async function setup(platform, configPath) {
  const handlers = new Map()
  const bindings = new Map()
  globalThis.__hoverShortcutMocks = {
    app: {},
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    systemPreferences: { isTrustedAccessibilityClient: () => true },
    globalShortcut: {
      register: (shortcut, handler) => {
        if (bindings.has(shortcut)) return false
        bindings.set(shortcut, handler)
        return true
      },
      unregister: (shortcut) => bindings.delete(shortcut),
      isRegistered: (shortcut) => bindings.has(shortcut)
    }
  }
  const bundled = await esbuild.build({
    stdin: {
      contents: `
        export { AppConfigStore } from './src/main/app-config'
        export { WordCaptureController } from './src/main/controller/word-capture'
        export { ShortcutRegister } from './src/main/shortcut-register'
        export * from './src/shared/shortcuts'
      `,
      resolveDir: root,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    define: { 'process.platform': JSON.stringify(platform) },
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'mock-hover-shortcut-system',
        setup(build) {
          build.onResolve({ filter: /^(electron|@dictol\/ocr-native)$/ }, ({ path }) => ({
            path,
            namespace: 'mock'
          }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents:
              path === 'electron'
                ? 'export const { app, ipcMain, systemPreferences, globalShortcut } = globalThis.__hoverShortcutMocks; export const shell = {}'
                : "export const getPermissionStatus = () => 'granted'; export const openPermissionSettings = async () => {}",
            loader: 'js'
          }))
        }
      }
    ]
  })
  const exports = compile(bundled.outputFiles[0].text)
  const runtimeSource = await esbuild.transform(
    readFileSync(path.join(root, 'src/main/app-runtime.ts'), 'utf8'),
    { loader: 'ts', format: 'cjs' }
  )
  const { AppRuntime } = compile(runtimeSource.code, {
    '../shared/shortcuts': exports,
    '../shared/ocr': { OCR_SUPPORTED: platform !== 'linux' }
  })
  const runtime = Object.create(AppRuntime.prototype)
  runtime.appConfig = new exports.AppConfigStore(configPath)
  runtime.shortcutRegister = new exports.ShortcutRegister()
  runtime.windowManager = {
    mainWindow: { isDestroyed: () => false, webContents: { id: 1 } }
  }
  runtime.selectionHookService = {
    getCapabilities: () => ({ supported: true, limitation: null })
  }
  const invocations = []
  runtime.ocrShortcutHandler = async (mode) => invocations.push(mode)
  new exports.WordCaptureController(runtime).mount()
  return { runtime, handlers, bindings, invocations }
}

for (const platform of ['win32', 'darwin']) {
  test(`${platform} hover shortcuts stay enabled and can be independently cleared and restored`, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'dictol-hover-shortcuts-'))
    const configPath = path.join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify({ featureFlags: { ocrLookup: false } }))
    try {
      const { runtime, handlers, bindings, invocations } = await setup(platform, configPath)
      const event = { sender: { id: 1 } }
      const setShortcut = (mode, shortcut) =>
        handlers.get('word-capture:set-ocr-shortcut')(event, mode, shortcut)
      const store = runtime.appConfig
      assert.equal(handlers.has('word-capture:set-ocr-enabled'), false)
      assert.equal(Object.hasOwn(store.load().featureFlags, 'ocrLookup'), false)
      runtime.restartOcrShortcuts()
      assert.deepEqual([...bindings.keys()], ['Alt+S', 'Alt+T'])
      await bindings.get('Alt+S')()
      await bindings.get('Alt+T')()
      assert.deepEqual(invocations, ['dictionary', 'ai'])

      for (const [mode, otherKey] of [
        ['dictionary', 'Alt+T'],
        ['ai', null]
      ]) {
        const result = setShortcut(mode, '   ')
        assert.equal(result.ok, true)
        assert.equal(result.status[mode === 'ai' ? 'ocrAiShortcut' : 'ocrDictionaryShortcut'], '')
        assert.equal(
          result.status[mode === 'ai' ? 'ocrAiRegistered' : 'ocrDictionaryRegistered'],
          false
        )
        assert.deepEqual([...bindings.keys()], otherKey ? [otherKey] : [])
      }
      assert.equal(
        Object.hasOwn(JSON.parse(readFileSync(configPath, 'utf8')).featureFlags, 'ocrLookup'),
        false
      )
      runtime.restartOcrShortcuts()
      assert.equal(bindings.size, 0)
      assert.equal(store.load().shortcuts.ocrDictionary, '')
      assert.equal(store.load().shortcuts.ocrAi, '')

      assert.equal(setShortcut('dictionary', ' Alt+Q ').ok, true)
      assert.equal(setShortcut('ai', 'Alt+W').ok, true)
      assert.deepEqual([...bindings.keys()], ['Alt+Q', 'Alt+W'])
      runtime.restartOcrShortcuts()
      assert.deepEqual([...bindings.keys()], ['Alt+Q', 'Alt+W'])
      const before = readFileSync(configPath, 'utf8')
      assert.equal(setShortcut('dictionary', 'Alt+W').ok, false)
      assert.equal(readFileSync(configPath, 'utf8'), before)
      assert.equal(bindings.has('Alt+Q'), true)
      assert.equal(bindings.has('Alt+W'), true)

      for (const [mode, shortcut] of [
        ['bad', 'Alt+Q'],
        ['ai', null],
        ['dictionary', 'x'.repeat(65)]
      ]) {
        assert.equal(setShortcut(mode, shortcut).ok, false)
      }
      assert.equal(readFileSync(configPath, 'utf8'), before)
      assert.equal(
        handlers.get('word-capture:set-ocr-shortcut')({ sender: { id: 2 } }, 'ai', ''),
        null
      )
      assert.equal(readFileSync(configPath, 'utf8'), before)
    } finally {
      delete globalThis.__hoverShortcutMocks
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('unsupported platforms do not register hover shortcuts', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dictol-hover-shortcuts-'))
  try {
    const { runtime, handlers, bindings } = await setup(
      'linux',
      path.join(directory, 'config.json')
    )
    runtime.restartOcrShortcuts()
    assert.equal(bindings.size, 0)
    const result = handlers.get('word-capture:set-ocr-shortcut')(
      { sender: { id: 1 } },
      'ai',
      'Alt+Q'
    )
    assert.equal(result.ok, false)
    assert.equal(result.status.ocrSupported, false)
  } finally {
    delete globalThis.__hoverShortcutMocks
    rmSync(directory, { recursive: true, force: true })
  }
})
