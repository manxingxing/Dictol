/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function captureWithLookup(lookup, mode) {
  const events = []
  globalThis.__noWordTest = { lookup, events }
  try {
    const root = path.resolve(__dirname, '..')
    const built = await esbuild.build({
      entryPoints: [path.join(root, 'src/main/ocr/ocr.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      define: { 'process.platform': '"darwin"', 'process.env.FORCE_OCR': 'undefined' },
      write: false,
      plugins: [
        {
          name: 'mock-accessibility-and-ocr',
          setup(build) {
            build.onResolve(
              {
                filter: /^(\.\.\/accessibility\/platforms\/macos|\.\/(mac-ocr|win-ocr))$/
              },
              ({ path: request }) => ({ path: request, namespace: 'mock' })
            )
            build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: request }) => ({
              contents: request.endsWith('/macos')
                ? `export async function readAccessibleTextAtCursor() {
                   globalThis.__noWordTest.events.push('accessibility')
                   return globalThis.__noWordTest.lookup
                 }`
                : `export async function captureTextUnderCursor() {
                   globalThis.__noWordTest.events.push('ocr')
                   return { selection: { word: 'ocr', sentence: '', context: '' }, wordBounds: {} }
                 }
                 export { captureTextUnderCursor as captureWindowsTextUnderCursor }`,
              loader: 'js'
            }))
          }
        }
      ]
    })
    const compiled = new Module(path.join(root, 'test-ocr-no-word.cjs'), module)
    compiled.filename = path.join(root, 'test-ocr-no-word.cjs')
    compiled.paths = module.paths
    compiled._compile(built.outputFiles[0].text, compiled.filename)
    const result = await compiled.exports.captureTextUnderCursor(mode)
    return { result, events }
  } finally {
    delete globalThis.__noWordTest
  }
}

for (const mode of ['dictionary', 'ai']) {
  test(`${mode} stops after verified whitespace`, async () => {
    const { result, events } = await captureWithLookup(
      { result: null, failure: 'no-word-at-point' },
      mode
    )
    assert.equal(result, null)
    assert.deepEqual(events, ['accessibility'])
  })
}

test('an inconclusive accessibility miss still reaches OCR', async () => {
  const { result, events } = await captureWithLookup(
    { result: null, failure: 'invalid-character-range' },
    'dictionary'
  )
  assert.equal(result.selection.word, 'ocr')
  assert.deepEqual(events, ['accessibility', 'ocr'])
})
