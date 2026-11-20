const { test } = require('node:test')
const assert = require('node:assert/strict')

test(
  'macOS lists shareable displays and windows',
  { skip: process.platform !== 'darwin' || process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1' },
  async (t) => {
    const capture = require('../../../native/ocr')
    if (capture.getPermissionStatus() !== 'granted') {
      t.skip('Screen recording permission is required for integration testing')
      return
    }
    const [displays, windows] = await Promise.all([
      capture.listShareableDisplays(),
      capture.listShareableWindows()
    ])
    assert.ok(displays.length > 0)
    for (const item of [...displays, ...windows]) {
      assert.ok(Number.isInteger(item.id) && item.id > 0)
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Number.isFinite(item.bounds[key]))
      }
      assert.ok(item.bounds.width > 0 && item.bounds.height > 0)
    }
    for (const window of windows) {
      assert.equal(typeof window.isOnScreen, 'boolean')
      assert.equal(typeof window.windowLayer, 'number')
      if (window.title !== undefined) assert.equal(typeof window.title, 'string')
      if (window.application !== undefined) {
        assert.equal(typeof window.application.processId, 'number')
        assert.equal(typeof window.application.name, 'string')
        assert.equal(typeof window.application.bundleIdentifier, 'string')
      }
    }
  }
)

test(
  'macOS capture API validates identifiers and regions',
  { skip: process.platform !== 'darwin' },
  () => {
    const capture = require('../../../native/ocr')
    for (const id of [0, -1, 1.5, NaN, Infinity, 2 ** 32]) {
      assert.throws(() => capture.captureDisplay(id), /Invalid display or window ID/)
      assert.throws(() => capture.captureWindow(id), /Invalid display or window ID/)
      assert.throws(
        () => capture.captureScreenRegion(id, 0, 0, 10, 10),
        /Invalid display or window ID/
      )
    }
    for (const region of [
      [0, 0, 0, 10],
      [0, 0, 10, -1],
      [NaN, 0, 10, 10]
    ]) {
      assert.throws(() => capture.captureScreenRegion(1, ...region), /Invalid screen region/)
    }
  }
)

test(
  'macOS OCR validates PNG buffers, languages and text offsets',
  { skip: process.platform !== 'darwin' },
  async () => {
    const api = require('../../../native/ocr')
    for (const png of [null, 'png', Buffer.alloc(0)]) {
      await assert.rejects(() => api.recognizeMacText(png, ['en-US']), /nonempty Buffer/)
    }
    for (const languages of [['en,US'], ['en\0US'], [1], 'en-US']) {
      await assert.rejects(
        () => api.recognizeMacText(Buffer.from('png'), languages),
        /OCR languages/
      )
      await assert.rejects(
        () => api.captureAndRecognizeMacText(1, 0, 0, 700, 300, languages),
        /OCR languages/
      )
    }
    for (const id of [0, -1, 1.5, NaN, Infinity, 2 ** 32]) {
      await assert.rejects(
        () => api.captureAndRecognizeMacText(id, 0, 0, 700, 300, []),
        /Invalid display or window ID/
      )
    }
    await assert.rejects(
      () => api.captureAndRecognizeMacText(1, 0, 0, 0, 300, []),
      /Invalid screen region/
    )
    for (const offset of [-1, 1.5, NaN, Infinity, 2 ** 32]) {
      assert.throws(() => api.chineseWordRange('text', offset), /UTF-16 offset/)
    }
  }
)

test(
  'macOS captures whole displays and an independent window',
  {
    skip: process.platform !== 'darwin' || process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1'
  },
  async (t) => {
    const api = require('../../../native/ocr')
    const displays = await api.listShareableDisplays()
    assert.ok(displays.length > 0)
    for (const display of displays) {
      const image = await api.captureDisplay(display.id)
      assert.ok(image.width >= display.bounds.width && image.height >= display.bounds.height)
      assert.equal(image.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      const rect = display.bounds
      const region = await api.captureScreenRegion(
        display.id,
        rect.x,
        rect.y,
        Math.min(100, rect.width),
        Math.min(100, rect.height)
      )
      assert.ok(region.width > 0 && region.height > 0)
    }
    const windows = await api.listShareableWindows()
    const window = process.env.DICTOL_SCREEN_CAPTURE_WINDOW_ID
      ? windows.find((item) => item.id === Number(process.env.DICTOL_SCREEN_CAPTURE_WINDOW_ID))
      : windows.find((item) => item.windowLayer === 0 && item.title)
    if (!window) {
      t.diagnostic('No independent application window available; window capture was not exercised')
      return
    }
    const image = await api.captureWindow(window.id)
    assert.ok(image.width > 0 && image.height > 0)
    assert.equal(image.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  }
)

test(
  'macOS input getters propagate their original exception without crashing the process',
  {
    skip: process.platform !== 'darwin'
  },
  () => {
    const { spawnSync } = require('node:child_process')
    const path = require('node:path')
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
    const assert = require('node:assert/strict');
    const api = require(process.argv[1]);
    (async () => {
      const failure = new Error('input getter failed');
      const languages = Object.defineProperty(['en-US'], 0, { get() { throw failure; } });
      await assert.rejects(() => api.recognizeMacText(Buffer.from('png'), languages), e => e === failure);
      await assert.rejects(() => api.captureAndRecognizeMacText(1, 0, 0, 700, 300, languages), e => e === failure);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `,
        path.resolve(__dirname, '../../../native/ocr')
      ],
      { encoding: 'utf8', timeout: 10000 }
    )
    assert.equal(result.signal, null, result.stderr)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.error, undefined)
  }
)
