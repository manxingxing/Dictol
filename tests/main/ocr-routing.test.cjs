/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function loadOcr(platform, mocks) {
  const root = path.resolve(__dirname, '../..')
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
          build.onResolve({ filter: /^\.\/(accessibility|mac-ocr|win-ocr)$/ }, ({ path }) => ({
            path,
            namespace: 'mock'
          }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
            const names = {
              './accessibility': 'captureAccessibleText, NO_WORD_AT_POINT',
              './mac-ocr': 'captureTextUnderCursor',
              './win-ocr': 'captureWindowsTextUnderCursor'
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
      NO_WORD_AT_POINT: 'no-word-at-point',
      captureAccessibleText: async () => {
        events.push('accessible')
        return accessible
      }
    },
    './mac-ocr': {
      captureTextUnderCursor: async (mode, ready) => {
        events.push(`vision:${mode}`)
        ready?.()
        return result('vision')
      }
    },
    './win-ocr': {
      captureWindowsTextUnderCursor: async (mode, ready) => {
        events.push(`windows:${mode}`)
        ready?.()
        return result('windows')
      }
    }
  }
}

async function withForceOcr(value, callback) {
  const previous = process.env.FORCE_OCR
  if (value === undefined) delete process.env.FORCE_OCR
  else process.env.FORCE_OCR = value
  try {
    return await callback()
  } finally {
    if (previous === undefined) delete process.env.FORCE_OCR
    else process.env.FORCE_OCR = previous
    delete globalThis.__ocrRoutingMocks
  }
}

for (const [platform, expected] of [
  ['darwin', 'vision'],
  ['win32', 'windows']
]) {
  test(`${platform} uses native OCR after accessibility misses`, () =>
    withForceOcr(undefined, async () => {
      const events = []
      const recognize = await loadOcr(platform, makeMocks(events))
      assert.equal((await recognize('dictionary')).selection.word, expected)
      assert.deepEqual(events, ['accessible', `${expected}:dictionary`])
    }))
  for (const mode of ['dictionary', 'ai']) {
    test(`FORCE_OCR skips accessible text for ${platform} ${mode}`, () =>
      withForceOcr('1', async () => {
        const events = []
        const accessible = {
          selection: { word: 'accessible', sentence: 'known', context: 'known' },
          wordBounds: {}
        }
        const recognize = await loadOcr(platform, makeMocks(events, accessible))
        let ready = 0
        assert.equal((await recognize(mode, () => ready++)).selection.word, expected)
        assert.deepEqual(events, [`${expected}:${mode}`])
        assert.equal(ready, 1)
      }))
  }
}

for (const mode of ['dictionary', 'ai']) {
  test(`${mode} still prefers accessibility when FORCE_OCR is unset`, () =>
    withForceOcr(undefined, async () => {
      const events = []
      const accessible = {
        selection: { word: 'accessible', sentence: 'known', context: 'known' },
        wordBounds: {}
      }
      const recognize = await loadOcr('darwin', makeMocks(events, accessible))
      assert.equal((await recognize(mode)).selection.word, 'accessible')
      assert.deepEqual(events, ['accessible'])
    }))
}

test('a set but empty FORCE_OCR also bypasses accessibility', () =>
  withForceOcr('', async () => {
    const events = []
    const recognize = await loadOcr('darwin', makeMocks(events, 'no-word-at-point'))
    assert.equal((await recognize('ai')).selection.word, 'vision')
    assert.deepEqual(events, ['vision:ai'])
  }))

test('native OCR failure is propagated', () =>
  withForceOcr('1', async () => {
    const events = []
    const mocks = makeMocks(events)
    const failure = new Error('Vision failed')
    mocks['./mac-ocr'].captureTextUnderCursor = async () => {
      throw failure
    }
    const recognize = await loadOcr('darwin', mocks)
    await assert.rejects(
      () => recognize('ai'),
      (error) => error === failure
    )
    assert.deepEqual(events, [])
  }))
