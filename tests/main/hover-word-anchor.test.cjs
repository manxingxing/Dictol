/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-empty-function */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

for (const mode of ['dictionary', 'ai']) {
  test(`${mode} uses the recognized word bounds for the explanation`, async () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/main/action/selection-explanation.ts'),
      'utf8'
    )
    const output = await esbuild.transform(source, { loader: 'ts', format: 'cjs' })
    const wordBounds = { x: 100, y: 200, width: 80, height: 20 }
    const calls = []
    const explanation = {
      prepareForOcrCapture: () => 1,
      isLookupCurrent: () => true,
      prewarmExplanationWindow() {},
      setAnchor: (anchor) => calls.push(['anchor', anchor]),
      beginOcrAiRecognition: () => 2,
      isOcrAiRecognitionCurrent: () => true,
      reposition: () => calls.push(['reposition']),
      showExplanation: async () => calls.push(['lookup']),
      showOcrAiExplanation: async () => calls.push(['lookup'])
    }
    const compiled = new Module(__filename, module)
    compiled.require = (id) => {
      if (id === '../lib/selection-position')
        return {
          createCursorAnchor: () => ({ cursor: true }),
          createWordAnchor: (bounds) => ({ wordBounds: bounds })
        }
      if (id === '../../shared/ocr-settings')
        return { windowsOcrLanguage: (config) => config.language }
      if (id === '../ocr/ocr')
        return {
          captureTextUnderCursor: async (_mode, ready, language, engine) => {
            assert.equal(engine, process.platform === 'win32' ? 'wgc' : undefined)
            assert.equal(language, process.platform === 'win32' ? 'ja-JP' : undefined)
            ready?.()
            return { wordBounds, selection: { word: 'example' } }
          }
        }
      return {}
    }
    compiled._compile(output.code, __filename)
    const action = new compiled.exports.SelectionExplanationAction({
      appConfig: { load: () => ({ ocr: { language: 'ja-JP', captureEngine: 'wgc' } }) },
      windowManager: { hideOcrHighlight() {}, showOcrHighlight() {} }
    })
    Object.assign(action, explanation)
    await action.lookupUnderCursor(mode)
    const anchorIndex = calls.findIndex(
      ([type, anchor]) => type === 'anchor' && anchor.wordBounds === wordBounds
    )
    const lookupIndex = calls.findIndex(([type]) => type === 'lookup')
    assert.ok(anchorIndex >= 0 && anchorIndex < lookupIndex)
    if (mode === 'ai') assert.ok(calls.findIndex(([type]) => type === 'reposition') > anchorIndex)
  })
}
