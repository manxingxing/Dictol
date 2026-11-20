const { test } = require('node:test')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

async function loadCapture(platform = process.platform, source = 'screen-capture.ts') {
  const root = path.resolve(__dirname, '../../..')
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main/ocr', source)],
    bundle: true,
    platform: 'node',
    define: {
      'process.platform': JSON.stringify(platform),
      'process.getSystemVersion': 'globalThis.__captureMocks.systemVersion'
    },
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'mock-native-and-electron',
        setup(build) {
          build.onResolve({ filter: /^(electron|@dictol\/ocr-native)$/ }, ({ path }) => ({
            path,
            namespace: 'mock'
          }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents:
              path === 'electron'
                ? 'export const { screen, nativeImage, desktopCapturer } = globalThis.__captureMocks.electron'
                : 'export const { captureScreenRegion, captureDisplay, captureAndRecognizeMacText, recognizeMacText, getPermissionStatus, getWindowsDisplayBoundsAtPoint } = globalThis.__captureMocks.native',
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

for (const platform of ['darwin', 'win32']) {
  test(`${platform} native capture failure falls back to a cropped Electron PNG`, async () => {
    const display = { id: 1, bounds: { x: -700, y: 0, width: 700, height: 300 }, scaleFactor: 2 }
    const region = { x: -650, y: 20, width: 100, height: 50 }
    let permission = 'granted'
    let fallbackFailure
    const failure = new Error('Electron capture failed')
    let crops = 0
    globalThis.__captureMocks = {
      systemVersion: () => '15.2',
      electron: {
        screen: {
          getAllDisplays: () => [display],
          dipToScreenPoint: ({ x, y }) => ({ x: x * 2, y: y * 2 })
        },
        desktopCapturer: {
          getSources: async () => {
            if (fallbackFailure) throw failure
            return [
              {
                display_id: '1',
                thumbnail: {
                  isEmpty: () => false,
                  getSize: () => ({ width: 1400, height: 600 }),
                  crop: (rect) => {
                    crops++
                    assert.deepEqual(rect, { x: 100, y: 40, width: 200, height: 100 })
                    return {
                      getSize: () => ({ width: 200, height: 100 }),
                      toPNG: () => Buffer.from('png')
                    }
                  }
                }
              }
            ]
          }
        }
      },
      native: {
        captureScreenRegion: async () => {
          throw new Error('native capture failed')
        },
        getPermissionStatus: () => permission,
        getWindowsDisplayBoundsAtPoint: () => ({
          id: '1',
          x: -1400,
          y: 0,
          width: 1400,
          height: 600
        })
      }
    }
    try {
      const { captureScreen } = await loadCapture(platform)
      const output = await captureScreen({ displayId: 1, region })
      assert.equal(output.backend, 'electron-fallback')
      assert.deepEqual(output.bounds, region)
      assert.deepEqual(output.pixelSize, { width: 200, height: 100 })
      assert.equal(output.data.toString(), 'png')
      await assert.rejects(
        () => captureScreen({ displayId: 1, region: { ...region, width: 0 } }),
        /截图区域/
      )
      assert.equal(crops, 1)
      fallbackFailure = true
      await assert.rejects(
        () => captureScreen({ displayId: 1, region }),
        (e) => e === failure
      )
      if (platform === 'darwin') {
        permission = 'not-granted'
        await assert.rejects(() => captureScreen({ displayId: 1, region }), /未获得屏幕录制权限/)
      }
    } finally {
      delete globalThis.__captureMocks
    }
  })
}

test('macOS region OCR transfers only results and falls back only for capture errors', async () => {
  const display = { id: 42, bounds: { x: -1440, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }
  const pointer = { x: -1400, y: 20 }
  let failure
  let fallbacks = 0
  let pngRecognitions = 0
  let permission = 'granted'
  let fallbackFailure
  globalThis.__captureMocks = {
    electron: {
      desktopCapturer: {
        getSources: async () => {
          fallbacks++
          if (fallbackFailure) throw fallbackFailure
          return [
            {
              display_id: '42',
              thumbnail: {
                isEmpty: () => false,
                getSize: () => ({ width: 2880, height: 1800 }),
                crop: (rect) => {
                  assert.deepEqual(rect, { x: 0, y: 0, width: 1400, height: 600 })
                  return {
                    toPNG: () => Buffer.from('fallback-png'),
                    getSize: () => ({ width: 1400, height: 600 })
                  }
                }
              }
            }
          ]
        }
      }
    },
    native: {
      captureAndRecognizeMacText: async (...args) => {
        assert.deepEqual(args, [42, -1440, 0, 700, 300, ['en-US']])
        if (failure) throw failure
        return { observations: [{ text: 'hello' }], width: 1400, height: 600 }
      },
      recognizeMacText: async (png, languages) => {
        pngRecognitions++
        assert.equal(png.toString(), 'fallback-png')
        assert.deepEqual(languages, ['en-US'])
        return { observations: [{ text: 'fallback' }] }
      },
      getPermissionStatus: () => permission
    }
  }
  try {
    const { captureMacOcrRegion } = await loadCapture('darwin', 'ocr-screen-capture.ts')
    const invoke = () =>
      captureMacOcrRegion(display, pointer, { width: 700, height: 300 }, ['en-US'])
    const output = await invoke()
    assert.equal(output.result.observations[0].text, 'hello')
    assert.deepEqual(output.frame.size, { width: 1400, height: 600 })
    assert.deepEqual(output.frame.region, { x: -1440, y: 0, width: 700, height: 300 })
    assert.deepEqual(output.frame.pointer, { x: 40 / 700, y: 20 / 300 })
    assert.equal(output.frame.buffer, undefined)
    assert.equal(fallbacks, 0)
    assert.equal(pngRecognitions, 0)
    failure = new Error('Vision failed')
    await assert.rejects(invoke, (error) => error === failure)
    assert.equal(fallbacks, 0)
    failure = Object.assign(new Error('capture failed'), { code: 'ERR_SCREEN_CAPTURE' })
    const fallback = await invoke()
    assert.equal(fallback.result.observations[0].text, 'fallback')
    assert.deepEqual(fallback.frame.region, output.frame.region)
    assert.equal(fallbacks, 1)
    assert.equal(pngRecognitions, 1)
    fallbackFailure = new Error('Electron failed')
    await assert.rejects(invoke, (error) => error === fallbackFailure)
    permission = 'not-granted'
    await assert.rejects(invoke, /未获得屏幕录制权限/)
  } finally {
    delete globalThis.__captureMocks
  }
})

test('macOS AI captures one bounded band and reuses its PNG for expanded recognition', async () => {
  const display = { id: 42, bounds: { x: -1440, y: 100, width: 1440, height: 900 }, scaleFactor: 2 }
  const pointer = { x: -1400, y: 120 }
  const png = Buffer.from('captured-band')
  let captures = 0
  let decodes = 0
  globalThis.__captureMocks = {
    systemVersion: () => '15.2',
    electron: {
      screen: { getAllDisplays: () => [display] },
      nativeImage: {
        createFromBuffer: (input) => {
          assert.strictEqual(input, png)
          decodes++
          return {
            crop: (rect) => {
              assert.deepEqual(rect, { x: 0, y: 0, width: 1920, height: 900 })
              return {
                toPNG: () => Buffer.from('first-recognition-crop'),
                getSize: () => ({ width: 1920, height: 900 })
              }
            }
          }
        }
      }
    },
    native: {
      captureScreenRegion: async (...args) => {
        assert.deepEqual(args, [42, -1440, 100, 1440, 600])
        captures++
        return { png, width: 2880, height: 1200 }
      }
    }
  }
  try {
    const { captureOcrRegion, cropOcrDisplay } = await loadCapture(
      'darwin',
      'ocr-screen-capture.ts'
    )
    const snapshot = await captureOcrRegion(display, pointer, { width: 1440, height: 600 })
    const first = cropOcrDisplay(snapshot, pointer, { width: 960, height: 450 })
    assert.deepEqual(first.region, { x: -1440, y: 100, width: 960, height: 450 })
    assert.deepEqual(first.pointer, { x: 40 / 960, y: 20 / 450 })
    const expanded = cropOcrDisplay(snapshot, pointer, null)
    assert.strictEqual(expanded.buffer, png)
    assert.deepEqual(expanded.region, { x: -1440, y: 100, width: 1440, height: 600 })
    assert.deepEqual(expanded.size, { width: 2880, height: 1200 })
    assert.deepEqual(expanded.pointer, { x: 40 / 1440, y: 20 / 600 })
    assert.equal(captures, 1)
    assert.equal(decodes, 1, 'Expanded recognition must reuse the captured PNG directly')
  } finally {
    delete globalThis.__captureMocks
  }
})
