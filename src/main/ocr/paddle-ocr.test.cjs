/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')
const sharp = require('sharp')

test('AI OCR uses the full captured area and maps the hit back to screen coordinates', async () => {
  const root = path.resolve(__dirname, '../../..')
  const png = await sharp({
    create: { width: 5120, height: 1200, channels: 3, background: 'white' }
  })
    .png()
    .toBuffer()
  const display = { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } }
  const pointer = { x: 1280, y: 300 }
  let sentSize
  globalThis.__paddleTestMocks = {
    electron: {
      screen: { getCursorScreenPoint: () => pointer, getDisplayNearestPoint: () => display }
    },
    '@dictol/ocr-native': { chineseWordRange: () => null },
    './native-ocr-capture': { captureBounds: () => ({ x: 0, y: 0, width: 2560, height: 600 }) },
    './screen-capture': {
      captureScreen: async () => ({
        data: png,
        bounds: { x: 0, y: 0, width: 2560, height: 600 },
        pixelSize: { width: 5120, height: 1200 },
        backend: 'test'
      })
    },
    './rapid-ocr': {
      recognizeRapidText: async (data) => {
        const { width, height } = await sharp(data).metadata()
        sentSize = { width, height }
        return { observations: [{ text: 'hello', x: 0.4, y: 0.45, width: 0.2, height: 0.1 }] }
      }
    }
  }
  try {
    const result = await esbuild.build({
      entryPoints: [path.join(root, 'src/main/ocr/paddle-ocr.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['sharp'],
      write: false,
      plugins: [
        {
          name: 'mock-paddle-dependencies',
          setup(build) {
            build.onResolve(
              {
                filter:
                  /^(electron|@dictol\/ocr-native|\.\/native-ocr-capture|\.\/screen-capture|\.\/rapid-ocr)$/
              },
              ({ path }) => ({ path, namespace: 'mock' })
            )
            build.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
              const names = {
                electron: 'screen',
                '@dictol/ocr-native': 'chineseWordRange',
                './native-ocr-capture': 'captureBounds',
                './screen-capture': 'captureScreen',
                './rapid-ocr': 'recognizeRapidText'
              }
              return {
                contents: `export const { ${names[path]} } = globalThis.__paddleTestMocks[${JSON.stringify(path)}]`,
                loader: 'js'
              }
            })
          }
        }
      ]
    })
    const compiled = new Module(path.join(root, 'test-paddle-ocr.cjs'), module)
    compiled.filename = path.join(root, 'test-paddle-ocr.cjs')
    compiled.paths = module.paths
    compiled._compile(result.outputFiles[0].text, compiled.filename)
    const hit = await compiled.exports.capturePaddleTextUnderCursor('ai')
    assert.deepEqual(sentSize, { width: 5120, height: 1200 })
    assert.equal(hit.selection.word, 'hello')
    assert.ok(hit.wordBounds.x <= pointer.x && hit.wordBounds.x + hit.wordBounds.width >= pointer.x)
    assert.ok(
      hit.wordBounds.y <= pointer.y && hit.wordBounds.y + hit.wordBounds.height >= pointer.y
    )
  } finally {
    delete globalThis.__paddleTestMocks
  }
})
