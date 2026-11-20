/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

const root = path.resolve(__dirname, '../..')

async function load(entry, options = {}) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    ...options
  })
  const compiled = new Module(path.join(root, 'test-bundle.cjs'), module)
  compiled.filename = path.join(root, 'test-bundle.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  return compiled.exports
}

test('selection and shortcut emit selected text without requesting context', async () => {
  const { SelectionHookService } = await load('src/main/selection-hook-service.ts')
  const service = new SelectionHookService()
  const captures = []
  service.onSelection((capture) => captures.push(capture))
  service.config.passiveMode = false
  service.handleTextSelection({ text: 'selected' })
  service.hook = { isRunning: () => true, getCurrentSelection: () => ({ text: 'shortcut' }) }
  service.handleShortcut()
  assert.deepEqual(captures, [
    { source: 'selection', selection: { text: 'selected' } },
    { source: 'shortcut', selection: { text: 'shortcut' } }
  ])
})

test('dictionary explanation retains AI lookup without a contextual selection button', async () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { DictionaryExplanation } = await load(
    'src/renderer/src/selection-explanation/DictionaryExplanation.tsx',
    { tsconfig: path.join(root, 'tsconfig.web.json') }
  )
  const html = renderToStaticMarkup(
    React.createElement(DictionaryExplanation, {
      payload: { mode: 'dictionary', requestId: 1, word: 'world', state: 'empty', aiEnabled: true }
    })
  )
  assert.match(html, /aria-label="AI 解释当前词"/)
  assert.doesNotMatch(html, /aria-label="AI 语境查词"/)
})
