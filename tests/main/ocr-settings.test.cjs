/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function loadSettings(handlers, platform = process.platform) {
  const root = path.resolve(__dirname, '../..')
  globalThis.__ocrSettingsMocks = { handlers }
  const result = await esbuild.build({
    stdin: {
      contents:
        "export { AppConfigStore } from './src/main/app-config'; export { AppController } from './src/main/controller/app'; export { OcrController } from './src/main/controller/ocr'",
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
        name: 'mock-settings-electron',
        setup(build) {
          build.onResolve({ filter: /^(electron|\.\.\/entry-assets)$/ }, ({ path }) => ({
            path,
            namespace: 'mock'
          }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents:
              path === 'electron'
                ? 'export const ipcMain = { handle: (name, handler) => globalThis.__ocrSettingsMocks.handlers.set(name, handler) }; export const app = {}, nativeTheme = {}, session = {}, shell = {}'
                : "export const DICTIONARY_SESSION_PARTITION = 'dictionary', EMBED_BROWSER_SESSION_PARTITION = 'embed'",
            loader: 'js'
          }))
        }
      }
    ]
  })
  const compiled = new Module(path.join(root, 'test-ocr-settings.cjs'), module)
  compiled.filename = path.join(root, 'test-ocr-settings.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  return compiled.exports
}

test('obsolete OCR engine settings are ignored and removed on save, with no engine IPC', async () => {
  const handlers = new Map()
  const { AppConfigStore, AppController } = await loadSettings(handlers)
  const directory = mkdtempSync(path.join(tmpdir(), 'dictol-ocr-settings-'))
  const configPath = path.join(directory, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      themeMode: 'dark',
      ocrEngine: 'paddle',
      featureFlags: { ocrLookup: true }
    })
  )
  try {
    const store = new AppConfigStore(configPath)
    const config = store.load()
    assert.equal(Object.hasOwn(config, 'ocrEngine'), false)
    assert.equal(config.themeMode, 'dark')
    assert.equal(Object.hasOwn(config.featureFlags, 'ocrLookup'), false)
    store.save(config)
    const persisted = JSON.parse(readFileSync(configPath, 'utf8'))
    assert.equal(Object.hasOwn(persisted, 'ocrEngine'), false)
    assert.equal(Object.hasOwn(persisted.featureFlags, 'ocrLookup'), false)
    new AppController({ appConfig: store }).mount()
    assert.equal(handlers.has('app:get-ocr-engine'), false)
    assert.equal(handlers.has('app:save-ocr-engine'), false)
  } finally {
    delete globalThis.__ocrSettingsMocks
    rmSync(directory, { recursive: true, force: true })
  }
})

test('reading persisted OCR values only fills defaults and preserves unrelated settings on save', async () => {
  const { AppConfigStore } = await loadSettings(new Map(), 'win32')
  const directory = mkdtempSync(path.join(tmpdir(), 'dictol-ocr-config-read-'))
  const configPath = path.join(directory, 'config.json')
  const defaults = { engine: 'system', language: 'system', captureEngine: 'gdi' }
  try {
    const store = new AppConfigStore(configPath)
    for (const ocr of [{}, { language: 'en-US' }, { language: 'es-ES', captureEngine: 'custom' }]) {
      writeFileSync(
        configPath,
        JSON.stringify({ themeMode: 'dark', shortcuts: { lookupWordOnShortcut: 'Alt+Q' }, ocr })
      )
      const before = readFileSync(configPath, 'utf8')
      const config = store.load()
      assert.deepEqual(config.ocr, { ...defaults, ...ocr })
      assert.equal(config.themeMode, 'dark')
      assert.equal(config.shortcuts.lookupWordOnShortcut, 'Alt+Q')
      assert.equal(readFileSync(configPath, 'utf8'), before)

      store.save({ ...config, dictionaryDisplay: 'name' })
      const persisted = JSON.parse(readFileSync(configPath, 'utf8'))
      assert.equal(persisted.dictionaryDisplay, 'name')
      assert.deepEqual(persisted.ocr, { ...defaults, ...ocr })
      assert.equal(persisted.themeMode, 'dark')
      assert.equal(persisted.shortcuts.lookupWordOnShortcut, 'Alt+Q')
    }
  } finally {
    delete globalThis.__ocrSettingsMocks
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const platform of ['win32', 'darwin']) {
  test(platform + ' OCR settings persistence, validation and platform isolation', async () => {
    const handlers = new Map()
    const { AppConfigStore, OcrController } = await loadSettings(handlers, platform)
    const directory = mkdtempSync(path.join(tmpdir(), 'dictol-ocr-language-'))
    const configPath = path.join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify({ themeMode: 'dark' }))
    try {
      const store = new AppConfigStore(configPath)
      assert.deepEqual(store.load().ocr, {
        engine: 'system',
        language: 'system',
        captureEngine: 'gdi'
      })
      new OcrController({ appConfig: store, mainWindow: { webContents: { id: 1 } } }).mount()
      if (platform === 'darwin') {
        assert.equal(handlers.size, 0)
        writeFileSync(
          configPath,
          JSON.stringify({ themeMode: 'dark', ocr: { language: 'invalid', captureEngine: 'wgc' } })
        )
        assert.deepEqual(store.load().ocr, {
          engine: 'system',
          language: 'system',
          captureEngine: 'gdi'
        })
        assert.equal(store.load().themeMode, 'dark')
        return
      }
      writeFileSync(configPath, JSON.stringify({ themeMode: 'dark', ocr: { language: 'en-US' } }))
      assert.deepEqual(store.load().ocr, {
        engine: 'system',
        language: 'en-US',
        captureEngine: 'gdi'
      })
      store.save(store.load())
      assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')).ocr, {
        engine: 'system',
        language: 'en-US',
        captureEngine: 'gdi'
      })
      const sender = { sender: { id: 1 } }
      const save = handlers.get('ocr:save-config')
      for (const language of ['system', 'zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE']) {
        assert.deepEqual(save(sender, { engine: 'system', language, captureEngine: 'gdi' }), {
          engine: 'system',
          language,
          captureEngine: 'gdi'
        })
        assert.equal(new AppConfigStore(configPath).load().ocr.language, language)
        assert.equal(store.load().themeMode, 'dark')
      }
      for (const captureEngine of ['gdi', 'wgc']) {
        const config = { engine: 'system', language: 'de-DE', captureEngine }
        assert.deepEqual(save(sender, config), config)
        assert.deepEqual(new AppConfigStore(configPath).load().ocr, config)
      }
      const before = readFileSync(configPath, 'utf8')
      for (const invalid of [
        null,
        {},
        { engine: 'system', language: 'invalid', captureEngine: 'gdi' },
        { engine: 'system', language: 42, captureEngine: 'gdi' },
        { engine: 'unknown', language: 'en-US', captureEngine: 'gdi' },
        { language: 'en-US', captureEngine: 'gdi' },
        { engine: 'system', language: 'en-US', captureEngine: 'auto' }
      ]) {
        assert.throws(() => save(sender, invalid), /OCR/)
      }
      assert.equal(readFileSync(configPath, 'utf8'), before)
      assert.equal(save({ sender: { id: 2 } }, { engine: 'system', language: 'en-US' }), null)
      assert.deepEqual(handlers.get('ocr:get-config')(sender), {
        engine: 'system',
        language: 'de-DE',
        captureEngine: 'wgc'
      })
    } finally {
      delete globalThis.__ocrSettingsMocks
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
