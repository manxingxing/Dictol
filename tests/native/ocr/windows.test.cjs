const { test } = require('node:test')
const assert = require('node:assert/strict')

test(
  'Windows capture validates identifiers and regions',
  { skip: process.platform !== 'win32' },
  () => {
    const capture = require('../../../native/ocr')
    for (const id of ['', '0', '-1', 'xyz']) {
      assert.throws(() => capture.captureDisplay(id), /Invalid Windows capture ID/)
      assert.throws(() => capture.captureWindow(id), /Invalid Windows capture ID/)
      assert.throws(
        () => capture.captureAndRecognizeWindowsText(id, 0, 0, 10, 10),
        /Invalid Windows capture ID/
      )
      assert.throws(
        () => capture.captureWindowsOcrImage(id, 0, 0, 10, 10),
        /Invalid Windows capture ID/
      )
      assert.throws(
        () => capture.captureScreenRegion(id, 0, 0, 10, 10),
        /Invalid Windows capture ID/
      )
    }
    assert.throws(() => capture.captureScreenRegion('1', 0, 0, 0, 1), /Invalid screen region/)
    for (const invalid of [-1, 1.5, Infinity, NaN, 2 ** 32]) {
      assert.throws(
        () => capture.captureAndRecognizeWindowsText('1', 0, 0, invalid, 1),
        /Invalid screen region/
      )
      assert.throws(
        () => capture.captureScreenRegion('1', 0, 0, invalid, 1),
        /Invalid screen region/
      )
    }
    assert.throws(() => capture.captureScreenRegion('1', 0.5, 0, 1, 1), /Invalid screen region/)
    for (const engine of ['auto', 'unknown']) {
      assert.throws(() => capture.captureDisplay('1', engine), /Invalid Windows capture engine/)
      assert.throws(() => capture.captureWindow('1', engine), /Invalid Windows capture engine/)
      assert.throws(
        () => capture.captureScreenRegion('1', 0, 0, 1, 1, engine),
        /Invalid Windows capture engine/
      )
      assert.throws(
        () => capture.captureAndRecognizeWindowsText('1', 0, 0, 1, 1, undefined, engine),
        /Invalid Windows capture engine/
      )
    }
  }
)

test(
  'Windows native image crops, reuses pixels and survives disposal during OCR',
  { skip: process.platform !== 'win32' || process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1' },
  async () => {
    const api = require('../../../native/ocr')
    const [display] = await api.listShareableDisplays()
    for (const engine of ['gdi', 'wgc']) {
      const image = await api.captureWindowsOcrImage(
        display.id,
        display.bounds.x,
        display.bounds.y,
        320,
        180,
        engine
      )
      try {
        assert.equal(image.width, 320)
        assert.equal(image.height, 180)
        assert.equal(image.png, undefined)
        for (const region of [
          { x: -1, y: 0, width: 10, height: 10 },
          { x: 0.5, y: 0, width: 10, height: 10 },
          { x: 0, y: 0, width: 0, height: 10 },
          { x: 310, y: 0, width: 20, height: 10 }
        ])
          assert.throws(() => image.recognize(region), /region/i)
        const crop = await image.recognize({ x: 30, y: 20, width: 160, height: 80 }, 'en-US')
        assert.deepEqual([crop.inputWidth, crop.inputHeight], [160, 80])
        assert.deepEqual([crop.processedWidth, crop.processedHeight], [160, 80])
        const pending = image.recognize(null, 'en-US')
        image.dispose()
        image.dispose()
        assert.throws(() => image.recognize(null, 'en-US'), /disposed/)
        const full = await pending
        assert.deepEqual([full.inputWidth, full.inputHeight], [320, 180])
        assert.deepEqual([full.processedWidth, full.processedHeight], [320, 180])
      } finally {
        image.dispose()
      }
    }
  }
)

test(
  'Windows native image handle is collectable without explicit disposal',
  {
    skip:
      process.platform !== 'win32' ||
      process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1' ||
      !global.gc
  },
  async () => {
    const api = require('../../../native/ocr')
    const [display] = await api.listShareableDisplays()
    const reference = await (async () => {
      const image = await api.captureWindowsOcrImage(
        display.id,
        display.bounds.x,
        display.bounds.y,
        320,
        180,
        'gdi'
      )
      return new WeakRef(image)
    })()
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setImmediate(resolve))
      global.gc()
      await new Promise((resolve) => setImmediate(resolve))
      if (!reference.deref()) break
    }
    assert.equal(reference.deref(), undefined)
  }
)

test(
  'Windows region OCR returns only OCR results without PNG or image handles',
  { skip: process.platform !== 'win32' || process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1' },
  async () => {
    const api = require('../../../native/ocr')
    const [display] = await api.listShareableDisplays()
    const { x, y, width, height } = display.bounds
    for (const engine of ['gdi', 'wgc']) {
      const output = await api.captureAndRecognizeWindowsText(
        display.id,
        x,
        y,
        Math.min(width, 1000),
        Math.min(height, 300),
        undefined,
        engine
      )
      assert.equal(output.png, undefined)
      assert.ok(Array.isArray(output.observations))
      assert.equal(output.inputWidth, Math.min(width, 1000))
      assert.equal(output.inputHeight, Math.min(height, 300))
      assert.equal(output.image, undefined)
    }
  }
)

test(
  'Windows captures the selected window',
  {
    skip:
      process.platform !== 'win32' ||
      process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1' ||
      !process.env.DICTOL_SCREEN_CAPTURE_WINDOW_ID
  },
  async () => {
    const capture = require('../../../native/ocr')
    for (const engine of ['gdi', 'wgc']) {
      const image = await capture.captureWindow(process.env.DICTOL_SCREEN_CAPTURE_WINDOW_ID, engine)
      assert.deepEqual(Object.keys(image).sort(), ['height', 'png', 'width'])
      assert.deepEqual(image.png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'))
      assert.equal(image.png.readUInt32BE(16), image.width)
      assert.equal(image.png.readUInt32BE(20), image.height)
      assert.ok(image.width > 0 && image.height > 0)
    }
  }
)

test(
  'Windows captures a display and region',
  { skip: process.platform !== 'win32' || process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1' },
  async () => {
    const capture = require('../../../native/ocr')
    const displays = await capture.listShareableDisplays()
    const windows = await capture.listShareableWindows()
    assert.ok(displays.length > 0)
    assert.ok(Array.isArray(windows))
    const display = displays[0]
    const { x, y, width, height } = display.bounds
    const point = capture.getWindowsDisplayBoundsAtPoint(
      x + Math.floor(width / 2),
      y + Math.floor(height / 2)
    )
    assert.equal(point.id, display.id)
    for (const engine of [undefined, 'gdi', 'wgc']) {
      const image = await capture.captureDisplay(display.id, engine)
      const region = await capture.captureScreenRegion(
        display.id,
        x,
        y,
        Math.min(width, 100),
        Math.min(height, 80),
        engine
      )
      for (const result of [image, region]) {
        assert.deepEqual(Object.keys(result).sort(), ['height', 'png', 'width'])
        assert.deepEqual(result.png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'))
        assert.equal(result.png.readUInt32BE(16), result.width)
        assert.equal(result.png.readUInt32BE(20), result.height)
      }
      assert.equal(region.width, Math.min(width, 100))
      assert.equal(region.height, Math.min(height, 80))
    }
  }
)
