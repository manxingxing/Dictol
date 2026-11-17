const { test } = require('node:test')
const assert = require('node:assert/strict')

const supported = ['darwin', 'win32'].includes(process.platform)

test('PNG OCR rejects invalid input', { skip: !supported }, async () => {
  const api = require('..')
  if (process.platform === 'darwin') {
    await assert.rejects(() => api.recognizeMacText(Buffer.from('not png'), ['en-US'], false))
  } else {
    await assert.rejects(() => api.recognizeWindowsText(Buffer.from('not png')))
  }
})

test('capture failure has a distinct error type', { skip: !supported }, async () => {
  const api = require('..')
  const capture =
    process.platform === 'darwin'
      ? () => api.captureAndRecognizeMacText(4294967295, 0, 0, 10, 10, null, ['en-US'], false)
      : () => api.captureAndRecognizeWindowsText('ffffffffffff', 0, 0, 10, 10, null)
  await assert.rejects(capture, api.ScreenCaptureError)
})

test(
  'captured frame can be recognized, cropped, and exported as PNG',
  {
    skip: !supported || process.env.DICTOL_SCREEN_CAPTURE_INTEGRATION !== '1'
  },
  async () => {
    const api = require('..')
    const [display] = await api.listShareableDisplays()
    assert.ok(display)
    const { x, y } = display.bounds
    const width = Math.min(700, display.bounds.width)
    const height = Math.min(300, display.bounds.height)
    const first =
      process.platform === 'darwin'
        ? await api.captureAndRecognizeMacText(
            display.id,
            x,
            y,
            width,
            height,
            null,
            ['en-US'],
            false
          )
        : await api.captureAndRecognizeWindowsText(display.id, x, y, width, height, null)
    assert.ok(first.snapshotWidth > 0 && first.snapshotHeight > 0)
    assert.ok(first.captureMs >= 0 && first.ocrMs >= 0)
    assert.ok(Array.isArray(first.result.observations))
    const crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
    const retryPromise =
      process.platform === 'darwin'
        ? api.recognizeMacSnapshot(first.snapshot, crop, ['en-US'], false)
        : api.recognizeWindowsSnapshot(first.snapshot, crop)
    if (process.platform === 'darwin') api.releaseMacSnapshot(first.snapshot)
    else api.releaseWindowsSnapshot(first.snapshot)
    const retry = await retryPromise
    assert.ok(Array.isArray(retry.result.observations))
    if (process.platform === 'darwin') {
      await assert.rejects(
        () => api.recognizeMacSnapshot(first.snapshot, crop, ['en-US'], false),
        /released/
      )
    } else {
      assert.throws(() => api.recognizeWindowsSnapshot(first.snapshot, crop), /released/)
    }
    const png = await api.captureScreenRegion(display.id, x, y, width, height)
    assert.deepEqual(png.png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'))
    const decoded =
      process.platform === 'darwin'
        ? await api.recognizeMacText(png.png, ['en-US'], false)
        : await api.recognizeWindowsText(png.png)
    assert.ok(Array.isArray(decoded.observations))
  }
)
