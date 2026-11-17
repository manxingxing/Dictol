/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const esbuild = require('esbuild')

async function loadService(platform, readAccessibleSelection) {
  globalThis.__selectionContextTestRead = readAccessibleSelection
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'selection-hook-service.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    define: { 'process.platform': JSON.stringify(platform) },
    write: false,
    plugins: [
      {
        name: 'mock-accessibility',
        setup(build) {
          build.onResolve({ filter: /^@dictol\/accessibility-native$/ }, () => ({
            path: 'accessibility',
            namespace: 'mock'
          }))
          build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
            contents:
              'export const readAccessibleSelection = globalThis.__selectionContextTestRead',
            loader: 'js'
          }))
        }
      }
    ]
  })
  const compiled = new Module(path.join(__dirname, 'selection-context-bundle.cjs'), module)
  compiled.filename = path.join(__dirname, 'selection-context-bundle.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  return new compiled.exports.SelectionHookService()
}

test('selection context is associated with the emitted selection without waiting', async () => {
  let complete
  const service = await loadService(
    'darwin',
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  service.config.passiveMode = false
  let capture
  service.onSelection((value) => {
    capture = value
  })
  service.handleTextSelection({ text: 'world' })
  assert.equal(capture.selection.text, 'world')
  complete({
    result: { selectedText: 'world', text: 'Hello world. Next sentence.', offset: 6 },
    failure: null
  })
  assert.deepEqual(await capture.context, {
    word: 'world',
    sentence: 'Hello world.',
    context: 'Hello world. Next sentence.'
  })
})

test('mismatched or unavailable accessibility selections do not supply context', async () => {
  for (const result of [
    { selectedText: 'other', text: 'Hello other.', offset: 6 },
    { selectedText: 'world', text: 'Hello other.', offset: 6 },
    { selectedText: 'world' },
    null
  ]) {
    const service = await loadService('win32', async () => ({ result, failure: null }))
    service.config.passiveMode = false
    let capture
    service.onSelection((value) => {
      capture = value
    })
    service.handleTextSelection({ text: 'world' })
    assert.equal(await capture.context, null)
  }
})

test('selection shortcuts capture context once for the same selection', async () => {
  let calls = 0
  const service = await loadService('darwin', async () => {
    calls++
    return { result: { selectedText: 'world', text: 'Hello world.', offset: 6 }, failure: null }
  })
  service.hook = { isRunning: () => true, getCurrentSelection: () => ({ text: 'world' }) }
  let capture
  service.onSelection((value) => {
    capture = value
  })
  service.handleShortcut()
  assert.equal((await capture.context).sentence, 'Hello world.')
  assert.equal(calls, 1)
})

async function loadExplanationController() {
  const fs = require('node:fs')
  const source = fs.readFileSync(
    path.join(__dirname, 'controller/selection-explanation.ts'),
    'utf8'
  )
  const output = await esbuild.transform(source, { loader: 'ts', format: 'cjs' })
  const compiled = new Module(path.join(__dirname, 'explanation-context-bundle.cjs'), module)
  compiled.filename = path.join(__dirname, 'explanation-context-bundle.cjs')
  compiled.paths = module.paths
  compiled.require = (id) => {
    if (id === './base-controller')
      return {
        BaseController: class {
          constructor(runtime) {
            this.runtime = runtime
          }
          get db() {
            return this.runtime.dbService
          }
        }
      }
    if (id === 'electron') return { ipcMain: {}, BrowserWindow: {} }
    return {}
  }
  compiled._compile(output.code, compiled.filename)
  return compiled.exports.SelectionExplanationController
}

test('the explanation window switches to contextual AI and back with the selected context', async () => {
  const Controller = await loadExplanationController()
  const updates = []
  const rows = []
  const win = {
    webContents: { id: 7, send: (_channel, payload) => updates.push(payload) },
    isVisible: () => true
  }
  const view = { hide() {} }
  const explanations = []
  const runtime = {
    dbService: {
      lookupDictionaryEntryGroup: async () => null,
      listReadyDictionaries: async () => []
    },
    appConfig: { load: () => ({ aiLookup: { enabled: true } }) },
    aiLookupService: {
      explainOcrContext: async (_id, selection) => {
        explanations.push(selection)
        return { phonetic: '', sentenceMeaning: '你好', wordMeaning: '世界', usage: '' }
      },
      cancel() {}
    },
    windowManager: {
      selectionExplanationWindow: win,
      selectionExplanationView: view,
      hideOcrHighlight() {},
      isSelectionExplanationPinned: () => false,
      setSelectionExplanationSwitcherVisible: (visible) => rows.push(visible)
    }
  }
  win.isDestroyed = () => false
  const controller = new Controller(runtime)
  controller.explanationLoaded = true
  controller.initializeExplanationWindow = () => win
  controller.positionExplanation = () => {}
  controller.showExplanationWindow = () => {}
  controller.waitForExplanationLoading = () => Promise.resolve()
  let finishContext
  const context = new Promise((resolve) => {
    finishContext = resolve
  })
  await controller.showExplanation('world', undefined, undefined, true, context)
  assert.equal(updates.at(-1).selectionContext, undefined)
  const selection = {
    word: 'world',
    sentence: 'Hello world.',
    context: 'Hello world. Next sentence.'
  }
  finishContext(selection)
  await context
  await Promise.resolve()
  assert.deepEqual(updates.at(-1).selectionContext, selection)
  assert.equal(rows.at(-1), false)
  controller.updateExplanation({
    mode: 'dictionary',
    requestId: updates.at(-1).requestId,
    word: 'world',
    state: 'content',
    activeDictionaryId: 'dictionary-2',
    dictionaries: [
      { dictionaryId: 'dictionary-2', dictionaryName: 'Dictionary', dictionaryIconUrl: null }
    ]
  })
  assert.deepEqual(updates.at(-1).selectionContext, selection)
  controller.showContextFromExplanation({ sender: { id: 7 } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(explanations, [selection])
  assert.equal(updates.at(-1).mode, 'ocr-ai')
  assert.equal(updates.at(-1).state, 'content')
  assert.deepEqual(updates.at(-1).selectionContext, selection)
  const showExplanation = controller.showExplanation.bind(controller)
  let restoredDictionary
  controller.showExplanation = (...args) => {
    restoredDictionary = args[1]
    return showExplanation(...args)
  }
  controller.returnToDictionary({ sender: { id: 7 } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(updates.at(-1).mode, 'dictionary')
  assert.deepEqual(updates.at(-1).selectionContext, selection)
  assert.equal(restoredDictionary, 'dictionary-2')
})

test('a late context cannot attach to a newer lookup of the same word', async () => {
  const Controller = await loadExplanationController()
  const updates = []
  const win = {
    webContents: { id: 7, send: (_channel, payload) => updates.push(payload) },
    isVisible: () => true,
    isDestroyed: () => false
  }
  const runtime = {
    dbService: {
      lookupDictionaryEntryGroup: async () => null,
      listReadyDictionaries: async () => []
    },
    appConfig: { load: () => ({ aiLookup: { enabled: true } }) },
    aiLookupService: { cancel() {} },
    windowManager: {
      selectionExplanationWindow: win,
      selectionExplanationView: { hide() {} },
      hideOcrHighlight() {},
      isSelectionExplanationPinned: () => false,
      setSelectionExplanationSwitcherVisible() {}
    }
  }
  const controller = new Controller(runtime)
  controller.explanationLoaded = true
  controller.initializeExplanationWindow = () => win
  controller.positionExplanation = () => {}
  controller.waitForExplanationLoading = () => Promise.resolve()
  let finishOld
  const old = new Promise((resolve) => {
    finishOld = resolve
  })
  await controller.showExplanation('world', undefined, undefined, true, old)
  await controller.showExplanation('world')
  finishOld({ word: 'world', sentence: 'Old world.', context: 'Old world.' })
  await old
  await Promise.resolve()
  assert.equal(updates.at(-1).selectionContext, undefined)
})

test('context button is shown only for available selection context', async () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const result = await esbuild.build({
    entryPoints: [
      path.join(__dirname, '../renderer/src/selection-explanation/DictionaryExplanation.tsx')
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    tsconfig: path.join(__dirname, '../../tsconfig.web.json'),
    write: false
  })
  const compiled = new Module(path.join(__dirname, 'dictionary-context-bundle.cjs'), module)
  compiled.filename = path.join(__dirname, 'dictionary-context-bundle.cjs')
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, compiled.filename)
  const payload = { mode: 'dictionary', requestId: 1, word: 'world', state: 'empty' }
  const render = (data) =>
    renderToStaticMarkup(
      React.createElement(compiled.exports.DictionaryExplanation, { payload: data })
    )
  assert.doesNotMatch(render(payload), /aria-label="AI 语境查词"/)
  const html = render({
    ...payload,
    selectionContext: { word: 'world', sentence: 'Hello world.', context: 'Hello world.' }
  })
  assert.match(html, /<header\b[^>]*>.*aria-label="AI 语境查词".*<\/header>/)
})
