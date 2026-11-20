/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function loadSettings(handlers) {
  const root = path.resolve(__dirname, '../..')
  globalThis.__ocrSettingsMocks = { handlers }
  const result = await esbuild.build({
    stdin: {
      contents:
        "export { AppConfigStore } from './src/main/app-config'; export { AppController } from './src/main/controller/app'",
      resolveDir: root,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
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
    assert.equal(config.featureFlags.ocrLookup, true)
    store.save(config)
    const persisted = JSON.parse(readFileSync(configPath, 'utf8'))
    assert.equal(Object.hasOwn(persisted, 'ocrEngine'), false)
    assert.equal(persisted.featureFlags.ocrLookup, true)
    new AppController({ appConfig: store }).mount()
    assert.equal(handlers.has('app:get-ocr-engine'), false)
    assert.equal(handlers.has('app:save-ocr-engine'), false)
  } finally {
    delete globalThis.__ocrSettingsMocks
    rmSync(directory, { recursive: true, force: true })
  }
})
