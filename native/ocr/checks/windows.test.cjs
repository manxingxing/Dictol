const { test } = require('node:test')
const assert = require('node:assert/strict')

test(
  'Windows capture validates identifiers and regions',
  { skip: process.platform !== 'win32' },
  () => {
    const capture = require('..')
    for (const id of ['', '0', '-1', 'xyz']) {
      assert.throws(() => capture.captureDisplay(id), /Invalid Windows capture ID/)
      assert.throws(() => capture.captureWindow(id), /Invalid Windows capture ID/)
      assert.throws(
        () => capture.captureScreenRegion(id, 0, 0, 10, 10),
        /Invalid Windows capture ID/
      )
    }
    assert.throws(() => capture.captureScreenRegion('1', 0, 0, 0, 1), /Invalid screen region/)
    for (const invalid of [-1, 1.5, Infinity, NaN, 2 ** 32]) {
      assert.throws(
        () => capture.captureScreenRegion('1', 0, 0, invalid, 1),
        /Invalid screen region/
      )
    }
    assert.throws(() => capture.captureScreenRegion('1', 0.5, 0, 1, 1), /Invalid screen region/)
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
    const capture = require('..')
    const image = await capture.captureWindow(process.env.DICTOL_SCREEN_CAPTURE_WINDOW_ID)
    assert.deepEqual(image.png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'))
    assert.equal(image.png.readUInt32BE(16), image.width)
    assert.equal(image.png.readUInt32BE(20), image.height)
    assert.ok(image.width > 0 && image.height > 0)
  }
)

test(
  'Windows captures a display and region',
  { skip: process.platform !== 'win32' || process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1' },
  async () => {
    const capture = require('..')
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
    const image = await capture.captureDisplay(display.id)
    const region = await capture.captureScreenRegion(
      display.id,
      x,
      y,
      Math.min(width, 100),
      Math.min(height, 80)
    )
    for (const result of [image, region]) {
      assert.deepEqual(result.png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'))
      assert.equal(result.png.readUInt32BE(16), result.width)
      assert.equal(result.png.readUInt32BE(20), result.height)
    }
    assert.equal(region.width, Math.min(width, 100))
    assert.equal(region.height, Math.min(height, 80))
  }
)
