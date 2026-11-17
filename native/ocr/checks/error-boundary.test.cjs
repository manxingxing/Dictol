const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')

function loadApi(platform, addon) {
  const source = readFileSync(join(__dirname, '../index.js'), 'utf8')
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    process: { platform, arch: 'test' },
    require: () => addon,
    Error,
    JSON
  })
  return module.exports
}

function baseAddon() {
  const names = [
    'captureScreenRegion',
    'captureDisplay',
    'captureWindow',
    'listShareableDisplays',
    'listShareableWindows',
    'hasScreenCapturePermission',
    'recognizeMacPng',
    'chineseWordRange',
    'captureAndRecognizeMacText',
    'recognizeMacSnapshot',
    'releaseMacSnapshot',
    'getWindowsDisplayBoundsAtPoint',
    'recognizeWindowsText',
    'captureAndRecognizeWindowsText',
    'recognizeWindowsSnapshot',
    'releaseWindowsSnapshot'
  ]
  return Object.fromEntries(names.map((name) => [name, () => {}]))
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform} wraps only native capture failures`, async () => {
    const addon = baseAddon()
    const method =
      platform === 'darwin' ? 'captureAndRecognizeMacText' : 'captureAndRecognizeWindowsText'
    let failure = new Error('DICTOL_CAPTURE_ERROR: screenshot failed')
    addon[method] = async () => {
      throw failure
    }
    const api = loadApi(platform, addon)
    await assert.rejects(
      () => api[method](),
      (error) => error instanceof api.ScreenCaptureError && error.message === 'screenshot failed'
    )
    failure = new Error('OCR failed')
    await assert.rejects(
      () => api[method](),
      (error) => error === failure && !(error instanceof api.ScreenCaptureError)
    )
  })
}

test('macOS OCR error payload cannot masquerade as a capture error and releases its snapshot', async () => {
  const addon = baseAddon()
  const snapshot = {}
  let released
  addon.captureAndRecognizeMacText = async () => ({
    snapshot,
    json: JSON.stringify({ error: 'DICTOL_CAPTURE_ERROR: OCR failed' })
  })
  addon.releaseMacSnapshot = (value) => {
    released = value
  }
  const api = loadApi('darwin', addon)
  await assert.rejects(
    () => api.captureAndRecognizeMacText(),
    (error) => !(error instanceof api.ScreenCaptureError) && /OCR failed/.test(error.message)
  )
  assert.strictEqual(released, snapshot)
})
