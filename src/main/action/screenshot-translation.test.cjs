/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */

const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function loadAction(mocks) {
  const root = path.resolve(__dirname, '../../..')
  globalThis.__screenshotTranslationMocks = mocks
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main/action/screenshot-translation.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'mock-screenshot-translation',
        setup(build) {
          build.onResolve(
            {
              filter:
                /^(electron|\.\.\/ocr\/screen-capture|\.\.\/ocr\/screenshot-ocr|\.\.\/lib\/selection-position|\.\.\/output-path)$/
            },
            ({ path }) => ({ path, namespace: 'mock' })
          )
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
            const names = {
              electron: 'app, BrowserWindow, Notification, screen',
              '../ocr/screen-capture': 'captureScreen',
              '../ocr/screenshot-ocr': 'recognizeScreenshotText',
              '../lib/selection-position': 'createCursorAnchor',
              '../output-path': 'resolvePreloadPath, resolveRendererUrl'
            }
            return {
              contents: `export const { ${names[path]} } = globalThis.__screenshotTranslationMocks[${JSON.stringify(path)}]`,
              loader: 'js'
            }
          })
        }
      }
    ]
  })
  const compiled = new Module(path.join(root, 'test-screenshot-action.cjs'), module)
  compiled.filename = path.join(root, 'test-screenshot-action.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  return compiled.exports.ScreenshotTranslationAction
}

test('selects first, captures the selected region, and uses the selected OCR engine', async () => {
  const events = []
  const windows = []
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } },
    { id: 2, bounds: { x: 100, y: 0, width: 100, height: 100 } }
  ]
  class Window {
    constructor(options) {
      this.bounds = options
      this.webContents = { id: windows.length + 1 }
      this.destroyed = false
      windows.push(this)
      events.push(`create:${this.webContents.id}`)
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    loadURL() {
      return Promise.resolve()
    }
    show() {
      events.push(`show:${this.webContents.id}`)
    }
    showInactive() {}
    focus() {}
    isDestroyed() {
      return this.destroyed
    }
    destroy() {
      this.destroyed = true
    }
    getBounds() {
      return this.bounds
    }
  }
  const mocks = {
    electron: {
      screen: {
        getCursorScreenPoint: () => ({ x: 20, y: 20 }),
        getDisplayNearestPoint: () => displays[0],
        getAllDisplays: () => displays,
        getDisplayMatching: () => ({ workArea: displays[0].bounds })
      },
      BrowserWindow: Window,
      Notification: class {},
      app: { isHidden: () => false }
    },
    '../ocr/screen-capture': {
      captureScreen: async (request) => {
        assert.ok(windows.every((window) => window.destroyed))
        events.push(`capture:${JSON.stringify(request)}`)
        return { data: Buffer.from('selected-png') }
      }
    },
    '../ocr/screenshot-ocr': {
      recognizeScreenshotText: async (engine, png) => {
        events.push(`ocr:${engine}:${png.toString()}`)
        return 'hello'
      }
    },
    '../lib/selection-position': { createCursorAnchor: () => ({}) },
    '../output-path': { resolvePreloadPath: () => '', resolveRendererUrl: () => '' }
  }
  const Action = await loadAction(mocks)
  const action = new Action({
    appConfig: { load: () => ({ ocrEngine: 'paddle' }) },
    actions: { translation: { showSelection: (text) => events.push(`translation:${text}`) } }
  })
  try {
    await action.toggleSelector()
    assert.deepEqual(events, ['create:1', 'create:2', 'show:1', 'show:2'])
    action.completeSelection(2, { x: 10, y: 20, width: 30, height: 40 })
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.deepEqual(
      events.filter((event) => /^(capture|ocr|translation):/.test(event)),
      [
        'capture:{"displayId":2,"region":{"x":110,"y":20,"width":30,"height":40}}',
        'ocr:paddle:selected-png',
        'translation:hello'
      ]
    )
  } finally {
    action.dispose()
    delete globalThis.__screenshotTranslationMocks
  }
})
