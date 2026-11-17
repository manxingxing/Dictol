/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function loadOcr(platform, mocks) {
  const root = path.resolve(__dirname, '../../..')
  globalThis.__ocrRoutingMocks = mocks
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main/ocr/ocr.ts')],
    bundle: true,
    platform: 'node',
    define: { 'process.platform': JSON.stringify(platform) },
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'mock-ocr-engines',
        setup(build) {
          build.onResolve(
            { filter: /^\.\/(accessibility|mac-ocr|win-ocr|paddle-ocr)$/ },
            ({ path }) => ({ path, namespace: 'mock' })
          )
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
            const names = {
              './accessibility': 'captureAccessibleText',
              './mac-ocr': 'captureTextUnderCursor',
              './win-ocr': 'captureWindowsTextUnderCursor',
              './paddle-ocr': 'capturePaddleTextUnderCursor'
            }
            return {
              contents: `export const { ${names[path]} } = globalThis.__ocrRoutingMocks[${JSON.stringify(path)}]`,
              loader: 'js'
            }
          })
        }
      }
    ]
  })
  const compiled = new Module(path.join(root, 'test-ocr-routing.cjs'), module)
  compiled.filename = path.join(root, 'test-ocr-routing.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  return compiled.exports.captureTextUnderCursor
}

function makeMocks(events, accessible = null) {
  const result = (word) => ({ selection: { word, sentence: word, context: word }, wordBounds: {} })
  return {
    './accessibility': {
      captureAccessibleText: async () => {
        events.push('accessible')
        return accessible
      }
    },
    './mac-ocr': {
      captureTextUnderCursor: async () => {
        events.push('vision')
        return result('vision')
      }
    },
    './win-ocr': {
      captureWindowsTextUnderCursor: async () => {
        events.push('windows')
        return result('windows')
      }
    },
    './paddle-ocr': {
      capturePaddleTextUnderCursor: async () => {
        events.push('paddle')
        return result('paddle')
      }
    }
  }
}

for (const [platform, engine, expected] of [
  ['darwin', 'system', 'vision'],
  ['win32', 'system', 'windows'],
  ['darwin', 'paddle', 'paddle'],
  ['win32', 'paddle', 'paddle']
]) {
  test(`${platform} uses ${expected} after accessibility misses`, async () => {
    const events = []
    try {
      const recognize = await loadOcr(platform, makeMocks(events))
      const result = await recognize('dictionary', undefined, engine)
      assert.equal(result.selection.word, expected)
      assert.deepEqual(events, ['accessible', expected])
    } finally {
      delete globalThis.__ocrRoutingMocks
    }
  })
}

test('accessible text wins even when PaddleOCR is selected', async () => {
  const events = []
  const accessible = {
    selection: { word: 'text', sentence: 'text', context: 'text' },
    wordBounds: {}
  }
  try {
    const recognize = await loadOcr('darwin', makeMocks(events, accessible))
    assert.equal((await recognize('dictionary', undefined, 'paddle')).selection.word, 'text')
    assert.deepEqual(events, ['accessible'])
  } finally {
    delete globalThis.__ocrRoutingMocks
  }
})

test('a selected engine failure is propagated instead of changing engines', async () => {
  const events = []
  const mocks = makeMocks(events)
  mocks['./paddle-ocr'].capturePaddleTextUnderCursor = async () => {
    throw new Error('model missing')
  }
  try {
    const recognize = await loadOcr('win32', mocks)
    await assert.rejects(() => recognize('dictionary', undefined, 'paddle'), /model missing/)
    assert.deepEqual(events, ['accessible'])
  } finally {
    delete globalThis.__ocrRoutingMocks
  }
})
