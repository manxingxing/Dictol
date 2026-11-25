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
  'Windows PNG OCR preserves normal sizes and limits the longest edge to min(engine limit, 3200)',
  {
    skip: process.platform !== 'win32'
  },
  async () => {
    const api = require('../../../native/ocr')
    const sharp = require('sharp')
    const png = async (width, height) =>
      sharp({
        create: { width, height, channels: 4, background: '#ffffff' }
      })
        .png()
        .toBuffer()
    const normal = await api.recognizeWindowsText(await png(400, 150))
    assert.deepEqual([normal.inputWidth, normal.inputHeight], [400, 150])
    assert.deepEqual([normal.processedWidth, normal.processedHeight], [400, 150])
    const limit = Math.min(normal.maxImageDimension, 3200)
    const width = limit + 1
    const large = await api.recognizeWindowsText(await png(width, 150))
    assert.equal(large.inputWidth, width)
    assert.equal(large.processedWidth, limit)
    assert.equal(large.processedHeight, Math.round((150 * limit) / width))
  }
)

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
