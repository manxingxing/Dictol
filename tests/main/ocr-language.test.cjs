const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

async function loadScreenshotOcr(platform, calls) {
  const root = path.resolve(__dirname, '../..')
  globalThis.__screenshotOcrLanguageCalls = calls
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main/ocr/screenshot-ocr.ts')],
    bundle: true,
    platform: 'node',
    define: { 'process.platform': JSON.stringify(platform) },
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'mock-screenshot-recognizer',
        setup(build) {
          build.onResolve({ filter: /^@dictol\/ocr-native$/ }, () => ({
            path: 'native',
            namespace: 'mock'
          }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
            contents: `
            const recognize = async (...args) => {
              globalThis.__screenshotOcrLanguageCalls.push(args);
              return { observations: [] };
            };
            export const recognizeWindowsText = recognize, recognizeMacText = recognize;
          `,
            loader: 'js'
          }))
        }
      }
    ]
  })
  const compiled = new Module(path.join(root, 'test-screenshot-language.cjs'), module)
  compiled.filename = path.join(root, 'test-screenshot-language.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  return compiled.exports.recognizeScreenshotText
}

for (const platform of ['win32', 'darwin']) {
  test(platform + ' screenshot OCR forwards the platform-specific settings', async () => {
    const calls = []
    const recognize = await loadScreenshotOcr(platform, calls)
    const png = Buffer.from('test image')
    try {
      if (platform === 'win32') {
        for (const language of ['system', 'zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE']) {
          await recognize(png, { engine: 'system', language, captureEngine: 'gdi' })
          assert.deepEqual(calls.at(-1), [png, language === 'system' ? undefined : language])
        }
      } else {
        const accurate = [
          png,
          ['en-US', 'zh-Hans', 'zh-Hant', 'ja-JP', 'fr-FR', 'ko-KR', 'de-DE'],
          'accurate'
        ]
        await recognize(png)
        await recognize(png, { engine: 'system', recognitionMode: 'fast' })
        await recognize(png, { engine: 'system', recognitionMode: 'accurate' })
        assert.deepEqual(calls, [accurate, [png, ['en-US', 'fr-FR', 'de-DE'], 'fast'], accurate])
      }
    } finally {
      delete globalThis.__screenshotOcrLanguageCalls
    }
  })
}
