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
                /^(electron|@dictol\/ocr-native|\.\/native-ocr-capture|\.\/ocr-text|\.\/ocr-crop)$/
            },
            ({ path }) => ({ path, namespace: 'mock' })
          )
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
            const exports = {
              electron: 'screen',
              '@dictol/ocr-native': 'chineseWordRange',
              './native-ocr-capture':
                'captureAndRecognize, captureBounds, recognizeSnapshot, releaseSnapshot',
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

function makeMocks(events, failure) {
  const snapshot = { id: 'same frame' }
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  const frame = (width, height) => ({
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
  globalThis.__hoverFlowMocks = {
    electron: {
      screen: {
        getCursorScreenPoint: () => ({ x: 100, y: 100 }),
        getDisplayNearestPoint: () => display
      }
    },
    '@dictol/ocr-native': { chineseWordRange: () => null },
    './ocr-crop': { contextTouchesCropEdge: () => false, mapOcrQuadToRegion: () => null },
    './ocr-text': { selectOcrTextHit: (observations) => (observations.length ? hit : null) },
    './native-ocr-capture': {
      captureAndRecognize: async (_display, _bounds, _pointer, size) => {
        events.push('capture')
        snapshot.bounds = _bounds
        return {
          snapshot,
          frame: frame(size.width, size.height),
          result: { observations: [], recognizerLanguage: 'en-US' }
        }
      },
      captureBounds: (_display, _pointer, size) => ({ x: 0, y: 0, ...size }),
      recognizeSnapshot: async (received, _pointer, size) => {
        assert.strictEqual(received, snapshot)
        events.push(size ? `retry:${size.width}x${size.height}` : 'retry:full')
        if (failure) throw new Error('recognition failure')
        size ??= snapshot.bounds
        return {
          frame: frame(size.width, size.height),
          result: { observations: size.width >= 1200 ? [{}] : [], recognizerLanguage: 'en-US' }
        }
      },
      releaseSnapshot: (received) => {
        assert.strictEqual(received, snapshot)
        events.push('release')
      }
    }
  }
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform} AI retries use one snapshot and release it after the callback`, async () => {
    const events = []
    makeMocks(events, false)
    if (platform === 'darwin') {
      const capture = globalThis.__hoverFlowMocks['./native-ocr-capture']
      const original = capture.captureAndRecognize
      capture.captureAndRecognize = async (display, bounds, pointer, size, options) => {
        assert.deepEqual(bounds, { x: 0, y: 0, width: 1920, height: 600 })
        assert.deepEqual(size, { width: 1280, height: 450 })
        return original(display, bounds, pointer, size, options)
      }
    }
    try {
      const flow = await loadFlow(platform)
      const fn =
        platform === 'darwin' ? flow.captureTextUnderCursor : flow.captureWindowsTextUnderCursor
      const result = await fn('ai', () => events.push('ready'))
      assert.equal(result.selection.word, 'example')
      assert.deepEqual(
        events,
        platform === 'darwin'
          ? ['capture', 'retry:full', 'ready', 'release']
          : ['capture', 'retry:550x290', 'retry:1434x800', 'ready', 'release']
      )
    } finally {
      delete globalThis.__hoverFlowMocks
    }
  })

  test(`${platform} releases the screenshot when a same-frame retry fails`, async () => {
    const events = []
    makeMocks(events, true)
    try {
      const flow = await loadFlow(platform)
      const fn =
        platform === 'darwin' ? flow.captureTextUnderCursor : flow.captureWindowsTextUnderCursor
      await assert.rejects(() => fn('ai', () => events.push('ready')), /recognition failure/)
      assert.deepEqual(
        events,
        platform === 'darwin'
          ? ['capture', 'retry:full', 'release']
          : ['capture', 'retry:550x290', 'release']
      )
    } finally {
      delete globalThis.__hoverFlowMocks
    }
  })
}

test('Windows dictionary retries English on the same frame and releases it', async () => {
  const events = []
  makeMocks(events, false)
  const capture = globalThis.__hoverFlowMocks['./native-ocr-capture']
  const snapshot = { id: 'first' }
  const frame = {
    size: { width: 850, height: 320 },
    pointer: { x: 0.5, y: 0.5 },
    region: { x: 0, y: 0, width: 850, height: 320 },
    mapBounds: () => ({ x: 10, y: 20, width: 30, height: 40 })
  }
  capture.captureAndRecognize = async () => {
    events.push('capture')
    return {
      snapshot,
      frame,
      result: { observations: [{ text: 'example' }], recognizerLanguage: 'zh-CN' }
    }
  }
  capture.recognizeSnapshot = async (received, _pointer, crop, options) => {
    assert.strictEqual(received, snapshot)
    assert.equal(crop, null)
    assert.equal(options.language, 'en-US')
    events.push('english')
    return { frame, result: { observations: [{ text: 'example' }], recognizerLanguage: 'en-US' } }
  }
  capture.releaseSnapshot = (received) => {
    assert.strictEqual(received, snapshot)
    events.push('release')
  }
  try {
    const flow = await loadFlow('win32')
    const result = await flow.captureWindowsTextUnderCursor('dictionary', () =>
      events.push('ready')
    )
    assert.equal(result.selection.word, 'example')
    assert.deepEqual(events, ['capture', 'english', 'ready', 'release'])
  } finally {
    delete globalThis.__hoverFlowMocks
  }
})

test('Windows dictionary releases both screenshots when the tighter retry fails', async () => {
  const events = []
  makeMocks(events, false)
  const capture = globalThis.__hoverFlowMocks['./native-ocr-capture']
  const first = { id: 'first' }
  const second = { id: 'second' }
  const frame = (width, height) => ({
    size: { width, height },
    pointer: { x: 0.5, y: 0.5 },
    region: { x: 0, y: 0, width, height },
    mapBounds: () => ({ x: 0, y: 0, width: 1, height: 1 })
  })
  capture.captureAndRecognize = async (_display, bounds) => {
    const initial = bounds.width === 850
    const snapshot = initial ? first : second
    events.push(`capture:${snapshot.id}`)
    return {
      snapshot,
      frame: frame(bounds.width, bounds.height),
      result: { observations: [], recognizerLanguage: 'en-US' }
    }
  }
  // An error during hit selection simulates failure after the second screenshot was acquired.
  let selections = 0
  globalThis.__hoverFlowMocks['./ocr-text'].selectOcrTextHit = () => {
    if (++selections === 2) throw new Error('selection failure')
    return null
  }
  capture.releaseSnapshot = (received) => events.push(`release:${received.id}`)
  try {
    const flow = await loadFlow('win32')
    await assert.rejects(
      () => flow.captureWindowsTextUnderCursor('dictionary'),
      /selection failure/
    )
    assert.deepEqual(events, ['capture:first', 'capture:second', 'release:second', 'release:first'])
  } finally {
    delete globalThis.__hoverFlowMocks
  }
})
