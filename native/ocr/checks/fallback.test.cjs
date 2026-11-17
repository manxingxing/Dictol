const { test } = require('node:test')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

async function loadCapture(platform = process.platform) {
  const root = path.resolve(__dirname, '../../..')
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main/ocr/native-ocr-capture.ts')],
    bundle: true,
    platform: 'node',
    define: { 'process.platform': JSON.stringify(platform) },
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'mock-native-and-electron',
        setup(build) {
          build.onResolve(
            { filter: /^(electron|@dictol\/ocr-native)$/ },
            ({ path }) => ({ path, namespace: 'mock' })
          )
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents:
              path === 'electron'
                ? 'export const { screen, nativeImage, desktopCapturer } = globalThis.__captureMocks.electron'
                : 'export const { ScreenCaptureError, captureScreenRegion, captureDisplay, captureAndRecognizeMacText, captureAndRecognizeWindowsText, getPermissionStatus, getWindowsDisplayBoundsAtPoint, recognizeMacSnapshot, recognizeMacText, recognizeWindowsSnapshot, recognizeWindowsText, releaseMacSnapshot, releaseWindowsSnapshot } = globalThis.__captureMocks.native',
            loader: 'js'
          }))
        }
      }
    ]
  })
  const compiled = new Module(path.join(root, 'test-capture.cjs'), module)
  compiled.filename = path.join(root, 'test-capture.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  return compiled.exports
}

test(
  'only capture failure invokes Electron and PNG OCR',
  { skip: process.platform !== 'darwin' },
  async () => {
    class ScreenCaptureError extends Error {}
    let fallbackCalls = 0
    let pngCalls = 0
    let failure = new ScreenCaptureError('capture failed')
    const thumbnail = {
      isEmpty: () => false,
      getSize: () => ({ width: 1400, height: 600 }),
      crop: () => ({
        getSize: () => ({ width: 1400, height: 600 }),
        toPNG: () => Buffer.from('png')
      })
    }
    globalThis.__captureMocks = {
      electron: {
        screen: {},
        nativeImage: {},
        desktopCapturer: {
          getSources: async () => {
            fallbackCalls++
            return [{ display_id: '1', thumbnail }]
          }
        }
      },
      native: {
        ScreenCaptureError,
        captureAndRecognizeMacText: async () => {
          throw failure
        },
        getPermissionStatus: () => 'granted',
        recognizeMacText: async () => {
          pngCalls++
          return { observations: [] }
        }
      }
    }
    try {
      const { captureAndRecognize } = await loadCapture()
      const display = { id: 1, bounds: { x: 0, y: 0, width: 700, height: 300 }, scaleFactor: 2 }
      const args = [display, display.bounds, { x: 350, y: 150 }, null, { languages: ['en-US'] }]
      const result = await captureAndRecognize(...args)
      assert.equal(result.snapshot.kind, 'fallback')
      assert.equal(fallbackCalls, 1)
      assert.equal(pngCalls, 1)
      failure = new Error('recognition failed')
      await assert.rejects(() => captureAndRecognize(...args), /recognition failed/)
      assert.equal(fallbackCalls, 1)
      assert.equal(pngCalls, 1)
    } finally {
      delete globalThis.__captureMocks
    }
  }
)

test(
  'same-frame crop maps Retina pixels back to global display points',
  { skip: process.platform !== 'darwin' },
  async () => {
    class ScreenCaptureError extends Error {}
    const calls = []
    const handle = {}
    globalThis.__captureMocks = {
      electron: { screen: {}, nativeImage: {}, desktopCapturer: {} },
      native: {
        ScreenCaptureError,
        captureAndRecognizeMacText: async (...args) => {
          calls.push(args)
          return {
            snapshot: handle,
            snapshotWidth: 2880,
            snapshotHeight: 1800,
            result: { observations: [] }
          }
        },
        recognizeMacSnapshot: async (...args) => {
          calls.push(args)
          return { result: { observations: [] } }
        }
      }
    }
    try {
      const { captureAndRecognize, recognizeSnapshot } = await loadCapture()
      const display = {
        id: 1,
        bounds: { x: -1440, y: 0, width: 1440, height: 900 },
        scaleFactor: 2
      }
      const pointer = { x: -1400, y: 20 }
      const initial = await captureAndRecognize(
        display,
        display.bounds,
        pointer,
        { width: 700, height: 300 },
        { languages: ['en-US'] }
      )
      assert.deepEqual(initial.frame.region, { x: -1440, y: 0, width: 700, height: 300 })
      assert.deepEqual(initial.frame.size, { width: 1400, height: 600 })
      const retry = await recognizeSnapshot(
        initial.snapshot,
        pointer,
        { width: 1000, height: 500 },
        { languages: ['en-US'] }
      )
      assert.deepEqual(retry.frame.region, { x: -1440, y: 0, width: 1000, height: 500 })
      assert.strictEqual(calls[1][0], handle)
    } finally {
      delete globalThis.__captureMocks
    }
  }
)

test('Windows capture failure falls back to Electron and PNG recognition', async () => {
  class ScreenCaptureError extends Error {}
  let fallbackCalls = 0
  let ocrCalls = 0
  let failure = new ScreenCaptureError('capture failed')
  const thumbnail = {
    isEmpty: () => false,
    getSize: () => ({ width: 1400, height: 600 }),
    crop: () => ({ getSize: () => ({ width: 1400, height: 600 }), toPNG: () => Buffer.from('png') })
  }
  globalThis.__captureMocks = {
    electron: {
      screen: { dipToScreenPoint: ({ x, y }) => ({ x: x * 2, y: y * 2 }) },
      nativeImage: {},
      desktopCapturer: {
        getSources: async () => {
          fallbackCalls++
          return [{ display_id: '1', thumbnail }]
        }
      }
    },
    native: {
      ScreenCaptureError,
      getWindowsDisplayBoundsAtPoint: () => ({ id: '1', x: 0, y: 0, width: 1400, height: 600 }),
      captureAndRecognizeWindowsText: async () => {
        throw failure
      },
      recognizeWindowsText: async () => {
        ocrCalls++
        return { observations: [] }
      }
    }
  }
  try {
    const { captureAndRecognize } = await loadCapture('win32')
    const display = { id: 1, bounds: { x: 0, y: 0, width: 700, height: 300 }, scaleFactor: 2 }
    const args = [display, display.bounds, { x: 350, y: 150 }, null, {}]
    const result = await captureAndRecognize(...args)
    assert.equal(result.snapshot.kind, 'fallback')
    assert.equal(fallbackCalls, 1)
    assert.equal(ocrCalls, 1)
    failure = new Error('recognition failed')
    await assert.rejects(() => captureAndRecognize(...args), /recognition failed/)
    assert.equal(fallbackCalls, 1)
    assert.equal(ocrCalls, 1)
  } finally {
    delete globalThis.__captureMocks
  }
})
