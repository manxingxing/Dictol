const { test } = require('node:test')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

for (const engine of ['gdi', 'wgc']) {
  for (const wholeDisplay of [false, true]) {
    test(`Windows ${engine} passes the engine for ${wholeDisplay ? 'display' : 'region'} capture without fallback`, async () => {
      const display = { id: 1, bounds: { x: 0, y: 0, width: 1024, height: 512 } }
      const calls = []
      const failure = new Error('Selected capture engine failed')
      let fail = false
      const capture = async (...args) => {
        calls.push(args)
        if (fail) throw failure
        return { png: Buffer.from('png'), width: 100, height: 50 }
      }
      globalThis.__captureMocks = {
        electron: {
          screen: { getAllDisplays: () => [display], dipToScreenPoint: (point) => point },
          desktopCapturer: {
            getSources: () => {
              throw new Error('Unexpected Electron fallback')
            }
          }
        },
        native: {
          captureDisplay: capture,
          captureScreenRegion: capture,
          getWindowsDisplayBoundsAtPoint: () => ({ id: 'a', ...display.bounds })
        }
      }
      try {
        const { captureScreen } = await loadCapture('win32')
        const request = {
          displayId: 1,
          windowsCaptureEngine: engine,
          ...(wholeDisplay ? {} : { region: { x: 16, y: 32, width: 128, height: 64 } })
        }
        await captureScreen(request)
        assert.deepEqual(calls, [wholeDisplay ? ['a', engine] : ['a', 16, 32, 128, 64, engine]])
        fail = true
        await assert.rejects(
          () => captureScreen(request),
          (error) => error === failure
        )
        assert.equal(calls.length, 2)
      } finally {
        delete globalThis.__captureMocks
      }
    })
  }
}

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
                : 'export const { captureScreenRegion, captureDisplay, captureAndRecognizeMacText, captureAndRecognizeWindowsText, captureMacOcrImage, captureWindowsOcrImage, recognizeMacText, getPermissionStatus, getWindowsDisplayBoundsAtPoint } = globalThis.__captureMocks.native',
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
  for (const wholeDisplay of [false, true]) {
    test(
      platform +
        ' native ' +
        (wholeDisplay ? 'display' : 'region') +
        ' capture propagates errors without fallback',
      async () => {
        const display = {
          id: 1,
          bounds: { x: -700, y: 0, width: 700, height: 300 },
          scaleFactor: 2
        }
        const region = { x: -650, y: 20, width: 100, height: 50 }
        let failure
        let fallbackCalls = 0
        let captures = 0
        const capture = async () => {
          captures++
          if (failure) throw failure
          return { png: Buffer.from('native-png'), width: 200, height: 100 }
        }
        globalThis.__captureMocks = {
          electron: {
            screen: {
              getAllDisplays: () => [display],
              dipToScreenPoint: ({ x, y }) => ({ x: x * 2, y: y * 2 })
            },
            desktopCapturer: {
              getSources: () => {
                fallbackCalls++
                throw new Error('Unexpected Electron fallback')
              }
            }
          },
          native: {
            captureScreenRegion: capture,
            captureDisplay: capture,
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
          const request = { displayId: 1, ...(wholeDisplay ? {} : { region }) }
          const output = await captureScreen(request)
          assert.equal(
            output.backend,
            platform === 'darwin' ? 'screencapturekit' : 'windows-native'
          )
          assert.deepEqual(output.bounds, wholeDisplay ? display.bounds : region)
          assert.deepEqual(output.pixelSize, { width: 200, height: 100 })
          assert.equal(output.data.toString(), 'native-png')
          for (failure of [
            new Error('native capture failed'),
            Object.assign(new Error('permission denied'), { code: 'ERR_SCREEN_CAPTURE' })
          ]) {
            await assert.rejects(
              () => captureScreen(request),
              (error) => error === failure
            )
          }
          assert.equal(captures, 3)
          await assert.rejects(
            () => captureScreen({ displayId: 1, region: { ...region, width: 0 } }),
            /截图区域/
          )
          assert.equal(captures, 3)
          assert.equal(fallbackCalls, 0)
        } finally {
          delete globalThis.__captureMocks
        }
      }
    )
  }
}

test('Windows region OCR maps DIP to pixels and returns metadata without a PNG', async () => {
  const display = { id: 1, bounds: { x: -2000, y: 0, width: 2000, height: 1080 } }
  const pointer = { x: -1980, y: 10 }
  const failure = new Error('WGC failed')
  let fail = false
  globalThis.__captureMocks = {
    electron: {
      screen: { dipToScreenPoint: ({ x, y }) => ({ x: x * 2, y: y * 2 }) },
      desktopCapturer: {
        getSources: () => {
          throw new Error('Unexpected fallback')
        }
      }
    },
    native: {
      getWindowsDisplayBoundsAtPoint: (x, y) => {
        assert.deepEqual({ x, y }, { x: -2000, y: 1080 })
        return { id: 'ab', x: -4000, y: 0, width: 4000, height: 2160 }
      },
      captureAndRecognizeWindowsText: async (...args) => {
        assert.deepEqual(args, ['ab', -4000, 0, 2000, 600, 'ja-JP', 'wgc'])
        if (fail) throw failure
        return { observations: [], inputWidth: 2000, inputHeight: 600 }
      }
    }
  }
  try {
    const { captureWindowsOcrRegion } = await loadCapture('win32', 'ocr-screen-capture.ts')
    const invoke = () =>
      captureWindowsOcrRegion(display, pointer, { width: 1000, height: 300 }, 'ja-JP', 'wgc')
    const output = await invoke()
    assert.equal(output.image, undefined)
    assert.equal(output.frame.buffer, undefined)
    assert.deepEqual(output.frame.size, { width: 2000, height: 600 })
    assert.deepEqual(output.frame.region, { x: -2000, y: 0, width: 1000, height: 300 })
    assert.deepEqual(output.frame.pointer, { x: 20 / 1000, y: 10 / 300 })
    fail = true
    await assert.rejects(invoke, (error) => error === failure)
  } finally {
    delete globalThis.__captureMocks
  }
})

test('macOS region OCR transfers only results and propagates capture and OCR errors', async () => {
  const display = { id: 42, bounds: { x: -1440, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }
  const pointer = { x: -1400, y: 20 }
  let failure
  let fallbackCalls = 0
  let pngRecognitions = 0
  globalThis.__captureMocks = {
    electron: {
      desktopCapturer: {
        getSources: () => {
          fallbackCalls++
          throw new Error('Unexpected Electron fallback')
        }
      }
    },
    native: {
      captureAndRecognizeMacText: async (...args) => {
        assert.deepEqual(args, [42, -1440, 0, 700, 300, ['en-US', 'fr-FR', 'de-DE'], 'fast'])
        if (failure) throw failure
        return { observations: [{ text: 'hello' }], width: 1400, height: 600 }
      },
      recognizeMacText: () => {
        pngRecognitions++
        throw new Error('Unexpected PNG OCR')
      }
    }
  }
  try {
    const { captureMacOcrRegion } = await loadCapture('darwin', 'ocr-screen-capture.ts')
    const invoke = () => captureMacOcrRegion(display, pointer, { width: 700, height: 300 }, 'fast')
    const output = await invoke()
    assert.equal(output.result.observations[0].text, 'hello')
    assert.deepEqual(output.frame.size, { width: 1400, height: 600 })
    assert.deepEqual(output.frame.region, { x: -1440, y: 0, width: 700, height: 300 })
    assert.deepEqual(output.frame.pointer, { x: 40 / 700, y: 20 / 300 })
    assert.equal(output.frame.buffer, undefined)
    for (failure of [
      new Error('Vision failed'),
      Object.assign(new Error('capture failed'), { code: 'ERR_SCREEN_CAPTURE' })
    ]) {
      await assert.rejects(invoke, (error) => error === failure)
    }
    assert.equal(fallbackCalls, 0)
    assert.equal(pngRecognitions, 0)
  } finally {
    delete globalThis.__captureMocks
  }
})

for (const platform of ['darwin', 'win32']) {
  test(
    platform + ' AI retains one native image and recognizes crop and full-image regions',
    async () => {
      const display = {
        id: 42,
        bounds: { x: -1440, y: 100, width: 1440, height: 900 },
        scaleFactor: 2
      }
      const pointer = { x: -1400, y: 120 }
      let captures = 0
      let failure
      let disposals = 0
      const recognized = []
      const nativeImage = {
        width: 2880,
        height: 1200,
        recognize: async (...args) => {
          recognized.push(args)
          return { observations: [] }
        },
        dispose: () => disposals++
      }
      const capture = async (...args) => {
        assert.deepEqual(
          args,
          platform === 'darwin'
            ? [42, -1440, 100, 1440, 600]
            : ['2a', -2880, 200, 2880, 1200, undefined]
        )
        captures++
        if (failure) throw failure
        return nativeImage
      }
      globalThis.__captureMocks = {
        systemVersion: () => '15.2',
        electron: {
          screen: {
            getAllDisplays: () => [display],
            dipToScreenPoint: ({ x, y }) => ({ x: x * 2, y: y * 2 })
          }
        },
        native: {
          getWindowsDisplayBoundsAtPoint: () => ({
            id: '2a',
            x: -2880,
            y: 200,
            width: 2880,
            height: 1800
          }),
          captureMacOcrImage: capture,
          captureWindowsOcrImage: capture
        }
      }
      try {
        const { captureOcrRegion, recognizeOcrSnapshot } = await loadCapture(
          platform,
          'ocr-screen-capture.ts'
        )
        const snapshot = await captureOcrRegion(
          display,
          pointer,
          { width: 1440, height: 600 },
          undefined,
          'fast'
        )
        const first = await recognizeOcrSnapshot(
          snapshot,
          pointer,
          { width: 960, height: 450 },
          'en-US'
        )
        assert.deepEqual(first.region, { x: -1440, y: 100, width: 960, height: 450 })
        assert.deepEqual(first.pointer, { x: 40 / 960, y: 20 / 450 })
        assert.deepEqual(first.size, { width: 1920, height: 900 })
        assert.equal(first.buffer, undefined)
        const expanded = await recognizeOcrSnapshot(snapshot, pointer, null, 'en-US')
        assert.deepEqual(expanded.region, { x: -1440, y: 100, width: 1440, height: 600 })
        assert.deepEqual(expanded.size, { width: 2880, height: 1200 })
        assert.equal(captures, 1)
        assert.deepEqual(
          recognized.map(([region]) => region),
          [{ x: 0, y: 0, width: 1920, height: 900 }, null]
        )
        assert.deepEqual(
          recognized.map(([, ...options]) => options),
          platform === 'darwin'
            ? [
                [['en-US', 'fr-FR', 'de-DE'], 'fast'],
                [['en-US', 'fr-FR', 'de-DE'], 'fast']
              ]
            : [['en-US'], ['en-US']]
        )
        snapshot.image.dispose()
        assert.equal(disposals, 1)
        for (failure of [
          new Error('native capture failed'),
          Object.assign(new Error('permission denied'), { code: 'ERR_SCREEN_CAPTURE' })
        ]) {
          await assert.rejects(
            () => captureOcrRegion(display, pointer, { width: 1440, height: 600 }),
            (error) => error === failure
          )
        }
        assert.equal(captures, 3)
        assert.equal(disposals, 1)
      } finally {
        delete globalThis.__captureMocks
      }
    }
  )
}
