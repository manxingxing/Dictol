const { test } = require('node:test')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

for (const engine of ['gdi', 'wgc']) {
  for (const mode of ['dictionary', 'ai']) {
    test(`Windows ${mode} keeps ${engine} for all capture requests`, async () => {
      makeMocks([])
      const capture = globalThis.__hoverFlowMocks['./ocr-screen-capture']
      const received = []
      const dictionary = capture.captureWindowsOcrRegion
      capture.captureWindowsOcrRegion = async (
        display,
        pointer,
        size,
        language,
        selectedEngine
      ) => {
        received.push(selectedEngine)
        const output = await dictionary(display, pointer, size)
        if (received.length === 1) output.result.observations = []
        return output
      }
      const ai = capture.captureOcrRegion
      capture.captureOcrRegion = async (display, pointer, size, selectedEngine) => {
        received.push(selectedEngine)
        return ai(display, pointer, size)
      }
      try {
        const flow = await loadFlow('win32')
        const result = await flow.captureWindowsTextUnderCursor(mode, undefined, 'en-US', engine)
        assert.equal(result.selection.word, 'example')
        assert.deepEqual(received, mode === 'dictionary' ? [engine, engine] : [engine])
      } finally {
        delete globalThis.__hoverFlowMocks
      }
    })
  }
}

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
                'captureMacOcrRegion, captureOcrRegion, captureWindowsOcrRegion, recognizeOcrSnapshot',
              './ocr-text': 'selectOcrTextHit',
              './ocr-crop': 'contextTouchesCropEdge, mapOcrQuadToRegion, defaultHorizontalPadding'
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
  const snapshot = { image: { dispose: () => events.push('dispose') }, bounds: display.bounds }
  const frame = ({ width, height }) => ({
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
  const recognize = async ({ width, height }) => {
    events.push(`ocr:${width}x${height}`)
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
    './ocr-crop': {
      contextTouchesCropEdge: () => false,
      mapOcrQuadToRegion: () => null,
      defaultHorizontalPadding: (width) => Math.max(2, Math.min(5, width * 0.05))
    },
    './ocr-text': { selectOcrTextHit: (observations) => (observations.length ? hit : null) },
    './ocr-screen-capture': {
      captureMacOcrRegion: async (_display, _pointer, size) => {
        assert.deepEqual(size, { width: 1000, height: 300 })
        events.push('capture:region-ocr')
        return { frame: frame(size), result: { observations: [{}] } }
      },
      captureOcrRegion: async (_display, _pointer, size) => {
        assert.deepEqual(size, { width: display.bounds.width, height: 600 })
        snapshot.bounds = { x: 0, y: 0, ...size }
        events.push('capture:band')
        return snapshot
      },
      captureWindowsOcrRegion: async (_display, _pointer, size) => {
        events.push('capture:native-region-ocr')
        const result = { observations: [{ text: 'example' }], recognizerLanguage: 'en-US' }
        return { frame: frame(size), result }
      },
      recognizeOcrSnapshot: async (received, _pointer, size, language) => {
        assert.strictEqual(received, snapshot)
        events.push(size ? `crop:${size.width}x${size.height}` : 'crop:full')
        const result = await globalThis.__hoverFlowMocks['@dictol/ocr-native'].recognizeWindowsText(
          size ?? snapshot.bounds,
          language
        )
        return { ...frame(size ?? snapshot.bounds), result }
      }
    }
  }
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform} AI reuses a native handle and disposes it after recognition`, async () => {
    const events = []
    makeMocks(events)
    try {
      const flow = await loadFlow(platform)
      const ready = () => events.push('ready')
      if (platform === 'darwin') {
        const capture = globalThis.__hoverFlowMocks['./ocr-screen-capture']
        const originalCapture = capture.captureOcrRegion
        capture.captureOcrRegion = (...args) => {
          assert.equal(args[4], 'fast')
          return originalCapture(...args)
        }
      }
      const result =
        platform === 'darwin'
          ? await flow.captureTextUnderCursor('ai', ready, 'fast')
          : await flow.captureWindowsTextUnderCursor('ai', ready)
      assert.equal(result.selection.word, 'example')
      assert.equal(events.filter((e) => e.startsWith('capture:')).length, 1)
      assert.deepEqual(events.slice(0, 4), [
        'capture:band',
        'ready',
        'crop:1280x450',
        'ocr:1280x450'
      ])
      assert.ok(events.includes('ocr:1920x600'))
      assert.equal(events.filter((event) => event.startsWith('ocr:')).length, 2)
      assert.equal(events.at(-1), 'dispose')
    } finally {
      delete globalThis.__hoverFlowMocks
    }
  })

  test(`${platform} releases the image on OCR failure`, async () => {
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
      assert.deepEqual(events, ['capture:band', 'ready', 'crop:1280x450', 'dispose'])
    } finally {
      delete globalThis.__hoverFlowMocks
    }
  })
}

for (const language of [undefined, 'en-US', 'zh-CN', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE']) {
  test(
    'Windows dictionary uses configured language without language retry: ' + language,
    async () => {
      const events = []
      makeMocks(events)
      globalThis.__hoverFlowMocks['@dictol/ocr-native'].recognizeWindowsText = () => {
        throw new Error('Unexpected PNG OCR')
      }
      let calls = 0
      globalThis.__hoverFlowMocks['./ocr-screen-capture'].captureWindowsOcrRegion = async (
        _d,
        _p,
        size,
        receivedLanguage
      ) => {
        calls++
        assert.equal(receivedLanguage, language)
        return {
          frame: {
            size,
            pointer: { x: 0.5, y: 0.5 },
            region: { x: 0, y: 0, ...size },
            mapBounds: () => ({ x: 10, y: 20, width: 30, height: 40 })
          },
          result: { observations: [{ text: 'example' }], recognizerLanguage: 'zh-CN' }
        }
      }
      try {
        const flow = await loadFlow('win32')
        assert.equal(
          (await flow.captureWindowsTextUnderCursor('dictionary', undefined, language)).selection
            .word,
          'example'
        )
        assert.equal(calls, 1)
      } finally {
        delete globalThis.__hoverFlowMocks
      }
    }
  )
}

for (const language of [undefined, 'ja-JP', 'en-US']) {
  test('Windows AI uses configured language for every crop: ' + language, async () => {
    const events = []
    makeMocks(events)
    const original = globalThis.__hoverFlowMocks['@dictol/ocr-native'].recognizeWindowsText
    const languages = []
    globalThis.__hoverFlowMocks['@dictol/ocr-native'].recognizeWindowsText = async (
      png,
      selected
    ) => {
      languages.push(selected)
      return original(png)
    }
    try {
      const flow = await loadFlow('win32')
      await flow.captureWindowsTextUnderCursor('ai', undefined, language)
      assert.equal(languages.length, 2)
      assert.ok(languages.every((selected) => selected === language))
    } finally {
      delete globalThis.__hoverFlowMocks
    }
  })
}

for (const fail of [false, true]) {
  test(
    'Windows dictionary ' +
      (fail ? 'propagates native errors' : 'retries a smaller native region on miss'),
    async () => {
      const events = []
      makeMocks(events)
      const sizes = []
      const failure = new Error('native capture or OCR failed')
      globalThis.__hoverFlowMocks['./ocr-screen-capture'].captureWindowsOcrRegion = async (
        _d,
        _p,
        size
      ) => {
        if (fail) throw failure
        sizes.push(size)
        return {
          frame: { size, pointer: { x: 0.5, y: 0.5 }, region: { x: 0, y: 0, ...size } },
          result: { observations: [], recognizerLanguage: 'en-US' },
          image: {
            recognize: () => {
              throw new Error('Unexpected English retry')
            }
          }
        }
      }
      try {
        const flow = await loadFlow('win32')
        if (fail)
          await assert.rejects(
            () => flow.captureWindowsTextUnderCursor('dictionary'),
            (e) => e === failure
          )
        else {
          assert.equal(await flow.captureWindowsTextUnderCursor('dictionary'), null)
          assert.deepEqual(sizes, [
            { width: 1000, height: 300 },
            { width: 550, height: 290 }
          ])
        }
        assert.deepEqual(events, [])
      } finally {
        delete globalThis.__hoverFlowMocks
      }
    }
  )
}

test('macOS dictionary uses one region OCR call without PNG recognition', async () => {
  const events = []
  makeMocks(events)
  try {
    const capture = globalThis.__hoverFlowMocks['./ocr-screen-capture']
    const originalCapture = capture.captureMacOcrRegion
    capture.captureMacOcrRegion = (...args) => {
      assert.equal(args[3], 'fast')
      return originalCapture(...args)
    }
    const flow = await loadFlow('darwin')
    const result = await flow.captureTextUnderCursor('dictionary', undefined, 'fast')
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

for (const platform of ['darwin', 'win32']) {
  for (const scenario of [
    { name: 'keeps first hit away from crop edges', edge: false, count: 1 },
    { name: 'does not retry complete context', edge: true, complete: true, count: 1 },
    { name: 'expands incomplete context once', edge: true, count: 2 },
    {
      name: 'returns a miss after one full-band retry',
      firstMiss: true,
      expandedMiss: true,
      count: 2
    },
    {
      name: 'keeps initial hit if expanded recognition misses',
      edge: true,
      expandedMiss: true,
      count: 2
    }
  ]) {
    test(platform + ' AI ' + scenario.name, async () => {
      const events = []
      makeMocks(events)
      const firstHit = {
        selection: { word: 'example', sentence: 'Example.', context: 'Example.' },
        bounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
        contextBounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
        hasBothAdjacentSentences: scenario.complete ?? false
      }
      const expandedHit = {
        ...firstHit,
        selection: { ...firstHit.selection, context: 'Before. Example. After.' }
      }
      let calls = 0
      const recognize = async () => {
        const hit =
          calls++ === 0
            ? scenario.firstMiss
              ? null
              : firstHit
            : scenario.expandedMiss
              ? null
              : expandedHit
        return { observations: hit ? [{ hit }] : [], recognizerLanguage: 'en-US' }
      }
      globalThis.__hoverFlowMocks['@dictol/ocr-native'].recognizeWindowsText = recognize
      globalThis.__hoverFlowMocks['@dictol/ocr-native'].recognizeMacText = recognize
      globalThis.__hoverFlowMocks['./ocr-text'].selectOcrTextHit = (observations) =>
        observations[0]?.hit ?? null
      globalThis.__hoverFlowMocks['./ocr-crop'].contextTouchesCropEdge = () =>
        scenario.edge ?? false
      try {
        const flow = await loadFlow(platform)
        const fn =
          platform === 'darwin' ? flow.captureTextUnderCursor : flow.captureWindowsTextUnderCursor
        const result = await fn('ai')
        assert.equal(calls, scenario.count)
        assert.equal(events.filter((e) => e === 'dispose').length, 1)
        assert.equal(events.filter((e) => e.startsWith('capture:')).length, 1)
        if (scenario.firstMiss && scenario.expandedMiss) assert.equal(result, null)
        else
          assert.equal(
            result.selection.context,
            scenario.count === 2 && !scenario.expandedMiss
              ? expandedHit.selection.context
              : firstHit.selection.context
          )
        assert.deepEqual(
          events.filter((e) => e.startsWith('crop:')),
          scenario.count === 1 ? ['crop:1280x450'] : ['crop:1280x450', 'crop:full']
        )
      } finally {
        delete globalThis.__hoverFlowMocks
      }
    })
  }

  test(platform + ' AI releases the handle if region recognition fails', async () => {
    const events = []
    makeMocks(events)
    const failure = new Error('native crop failed')
    globalThis.__hoverFlowMocks['./ocr-screen-capture'].recognizeOcrSnapshot = async () => {
      throw failure
    }
    try {
      const flow = await loadFlow(platform)
      const fn =
        platform === 'darwin' ? flow.captureTextUnderCursor : flow.captureWindowsTextUnderCursor
      await assert.rejects(
        () => fn('ai', () => events.push('ready')),
        (error) => error === failure
      )
      assert.deepEqual(events, ['capture:band', 'ready', 'dispose'])
    } finally {
      delete globalThis.__hoverFlowMocks
    }
  })
}
