const { test } = require('node:test')
const assert = require('node:assert/strict')

const supported = ['darwin', 'win32'].includes(process.platform)

test('PNG OCR rejects invalid input', { skip: !supported }, async () => {
  const api = require('../../../native/ocr')
  if (process.platform === 'darwin') {
    await assert.rejects(() => api.recognizeMacText(Buffer.from('not png'), ['en-US']))
  } else {
    await assert.rejects(() => api.recognizeWindowsText(Buffer.from('not png')))
  }
})

test(
  'captured region PNG can be recognized independently',
  {
    skip: !supported || process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1'
  },
  async () => {
    const api = require('../../../native/ocr')
    const [display] = await api.listShareableDisplays()
    assert.ok(display)
    const { x, y } = display.bounds
    const width = Math.min(700, display.bounds.width)
    const height = Math.min(300, display.bounds.height)
    const png = await api.captureScreenRegion(display.id, x, y, width, height)
    assert.deepEqual(png.png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'))
    const decoded =
      process.platform === 'darwin'
        ? await api.recognizeMacText(png.png, ['en-US'])
        : await api.recognizeWindowsText(png.png)
    assert.ok(Array.isArray(decoded.observations))
  }
)
