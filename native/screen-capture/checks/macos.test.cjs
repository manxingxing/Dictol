const { test } = require('node:test')
const assert = require('node:assert/strict')

test(
  'macOS lists shareable displays and windows',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const capture = require('..')
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
    const capture = require('..')
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
