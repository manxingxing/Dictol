const { test } = require('node:test')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

async function loadFlow(platform) {
  const root = path.resolve(__dirname, '../../..')
  const source = platform === 'darwin' ? 'mac-ocr.ts' : 'win-ocr.ts'
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main/ocr', source)],
    bundle: true,
    platform: 'node',
    define: { 'process.platform': JSON.stringify(platform) },
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'mock-hover-dependencies',
        setup(build) {
          build.onResolve(
            {
              filter:
                /^(electron|@dictol\/ocr-native|\.\/ocr-screen-capture|\.\/ocr-text|\.\/ocr-crop)$/
            },
            ({ path }) => ({ path, namespace: 'mock' })
          )
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
            const exports = {
              electron: 'screen',
              '@dictol/ocr-native': 'chineseWordRange, recognizeMacText, recognizeWindowsText',
              './ocr-screen-capture':
                'captureMacOcrRegion, captureOcrRegion, captureOcrDisplay, captureOcrImage, cropOcrDisplay',
              './ocr-text': 'selectOcrTextHit',
              './ocr-crop': 'contextTouchesCropEdge, mapOcrQuadToRegion'
            }
            return {
              contents: `export const { ${exports[path]} } = globalThis.__hoverFlowMocks[${JSON.stringify(path)}]`,
              loader: 'js'
            }
          })
        }
      }
    ]
  })
  const compiled = new Module(path.join(root, 'test-hover-flow.cjs'), module)
  compiled.filename = path.join(root, 'test-hover-flow.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  return compiled.exports
}

function makeMocks(events) {
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  const snapshot = { image: { data: Buffer.from('display-png'), bounds: display.bounds } }
  const frame = ({ width, height }) => ({
    buffer: Buffer.from(`${width}x${height}`),
    size: { width, height },
    pointer: { x: 0.5, y: 0.5 },
    region: { x: 0, y: 0, width, height },
    mapBounds: () => ({ x: 10, y: 20, width: 30, height: 40 })
  })
  const hit = {
    selection: { word: 'example', sentence: 'Example.', context: 'Example.' },
    bounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
    contextBounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
    hasBothAdjacentSentences: false
  }
  const recognize = async (png) => {
    assert.ok(Buffer.isBuffer(png))
    events.push(`ocr:${png}`)
    const [width, height] = png.toString().split('x').map(Number)
    return {
      observations: width >= 1200 && height >= 600 ? [{}] : [],
      recognizerLanguage: 'en-US'
    }
  }
  globalThis.__hoverFlowMocks = {
    electron: {
      screen: {
        getCursorScreenPoint: () => ({ x: 100, y: 100 }),
        getDisplayNearestPoint: () => display
      }
    },
    '@dictol/ocr-native': {
      chineseWordRange: () => null,
      recognizeMacText: recognize,
      recognizeWindowsText: recognize
    },
    './ocr-crop': { contextTouchesCropEdge: () => false, mapOcrQuadToRegion: () => null },
    './ocr-text': { selectOcrTextHit: (observations) => (observations.length ? hit : null) },
    './ocr-screen-capture': {
      captureMacOcrRegion: async (_display, _pointer, size) => {
        assert.deepEqual(size, { width: 1000, height: 300 })
        events.push('capture:region-ocr')
        return { frame: frame(size), result: { observations: [{}] } }
      },
      captureOcrRegion: async (_display, _pointer, size) => {
        assert.deepEqual(size, { width: display.bounds.width, height: 600 })
        snapshot.image.bounds = { x: 0, y: 0, ...size }
        events.push('capture:band')
        return snapshot
      },
      captureOcrDisplay: async () => {
        events.push('capture:display')
        return snapshot
      },
      captureOcrImage: async (_display, _pointer, size) => {
        events.push('capture:region')
        return frame(size)
      },
      cropOcrDisplay: (received, _pointer, size) => {
        assert.strictEqual(received, snapshot)
        events.push(size ? `crop:${size.width}x${size.height}` : 'crop:full')
        return frame(size ?? snapshot.image.bounds)
      }
    }
  }
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform} AI crops the same PNG and shows progress before recognition`, async () => {
    const events = []
    makeMocks(events)
    try {
      const flow = await loadFlow(platform)
      const fn =
        platform === 'darwin' ? flow.captureTextUnderCursor : flow.captureWindowsTextUnderCursor
      const result = await fn('ai', () => events.push('ready'))
      assert.equal(result.selection.word, 'example')
      assert.equal(events.filter((e) => e.startsWith('capture:')).length, 1)
      assert.deepEqual(
        events.slice(0, 4),
        platform === 'darwin'
          ? ['capture:band', 'crop:1280x450', 'ready', 'ocr:1280x450']
          : ['capture:display', 'crop:1024x500', 'ready', 'ocr:1024x500']
      )
      assert.ok(events.includes(platform === 'darwin' ? 'ocr:1920x600' : 'ocr:1434x800'))
      if (platform === 'darwin') {
        assert.equal(events.filter((event) => event.startsWith('ocr:')).length, 2)
      }
    } finally {
      delete globalThis.__hoverFlowMocks
    }
  })

  test(`${platform} propagates PNG OCR failures`, async () => {
    const events = []
    makeMocks(events)
    const failure = new Error('recognition failed')
    const native = globalThis.__hoverFlowMocks['@dictol/ocr-native']
    native.recognizeMacText = native.recognizeWindowsText = async () => {
      throw failure
    }
    try {
      const flow = await loadFlow(platform)
      const fn =
        platform === 'darwin' ? flow.captureTextUnderCursor : flow.captureWindowsTextUnderCursor
      await assert.rejects(
        () => fn('ai', () => events.push('ready')),
        (e) => e === failure
      )
      assert.deepEqual(
        events,
        platform === 'darwin'
          ? ['capture:band', 'crop:1280x450', 'ready']
          : ['capture:display', 'crop:1024x500', 'ready']
      )
    } finally {
      delete globalThis.__hoverFlowMocks
    }
  })
}

test('Windows dictionary retries English with the same PNG buffer', async () => {
  const events = []
  makeMocks(events)
  const buffers = []
  globalThis.__hoverFlowMocks['@dictol/ocr-native'].recognizeWindowsText = async (
    png,
    language
  ) => {
    buffers.push(png)
    events.push(language ?? 'profile')
    return { observations: [{ text: 'example' }], recognizerLanguage: language ?? 'zh-CN' }
  }
  try {
    const flow = await loadFlow('win32')
    const result = await flow.captureWindowsTextUnderCursor('dictionary')
    assert.equal(result.selection.word, 'example')
    assert.deepEqual(events, ['capture:region', 'profile', 'en-US'])
    assert.strictEqual(buffers[0], buffers[1])
  } finally {
    delete globalThis.__hoverFlowMocks
  }
})

test('macOS dictionary uses one region OCR call without PNG recognition', async () => {
  const events = []
  makeMocks(events)
  try {
    const flow = await loadFlow('darwin')
    const result = await flow.captureTextUnderCursor('dictionary')
    assert.equal(result.selection.word, 'example')
    assert.deepEqual(result.wordBounds, { x: 10, y: 20, width: 30, height: 40 })
    assert.deepEqual(events, ['capture:region-ocr'])
  } finally {
    delete globalThis.__hoverFlowMocks
  }
})

test('macOS dictionary returns a miss after one region OCR call', async () => {
  const events = []
  makeMocks(events)
  let calls = 0
  globalThis.__hoverFlowMocks['./ocr-screen-capture'].captureMacOcrRegion = async () => {
    calls++
    return {
      frame: {
        pointer: { x: 0.5, y: 0.5 },
        size: { width: 1400, height: 600 },
        mapBounds: () => ({ x: 10, y: 20, width: 30, height: 40 })
      },
      result: { observations: [] }
    }
  }
  try {
    const flow = await loadFlow('darwin')
    const result = await flow.captureTextUnderCursor('dictionary')
    assert.equal(calls, 1)
    assert.equal(result, null)
    assert.deepEqual(events, [])
  } finally {
    delete globalThis.__hoverFlowMocks
  }
})

test('macOS dictionary propagates region OCR errors', async () => {
  const events = []
  makeMocks(events)
  const failure = new Error('Vision failed')
  globalThis.__hoverFlowMocks['./ocr-screen-capture'].captureMacOcrRegion = async () => {
    throw failure
  }
  try {
    const flow = await loadFlow('darwin')
    await assert.rejects(
      () => flow.captureTextUnderCursor('dictionary'),
      (error) => error === failure
    )
    assert.deepEqual(events, [])
  } finally {
    delete globalThis.__hoverFlowMocks
  }
})
