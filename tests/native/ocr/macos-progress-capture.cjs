// Manual Electron integration check. Captures only the opaque synthetic target window's region.
const assert = require('node:assert/strict')
const { app, BrowserWindow, screen } = require('electron')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const api = require('../../../native/ocr')

const userData = mkdtempSync(path.join(tmpdir(), 'dictol-progress-capture-'))
app.setPath('userData', userData)
const windows = []
const timeout = setTimeout(() => {
  console.error('PNG capture check timed out')
  finish(1)
}, 15000)

async function main() {
  await app.whenReady()
  const display = screen.getPrimaryDisplay()
  const target = new BrowserWindow({
    x: display.workArea.x + 60,
    y: display.workArea.y + 60,
    width: 700,
    height: 300,
    frame: false,
    hasShadow: false,
    backgroundColor: '#ffffff'
  })
  windows.push(target)
  target.setAlwaysOnTop(true, 'floating')
  await target.loadURL(
    'data:text/html,<body style="background:white;font:48px Arial;padding:20px">Hello Dictol</body>'
  )
  const region = target.getBounds()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const regionOcr = await api.captureAndRecognizeMacText(
    display.id,
    region.x,
    region.y,
    region.width,
    region.height,
    ['en-US']
  )
  assert.match(regionOcr.observations.map((line) => line.text).join(' '), /Hello Dictol/i)
  assert.equal(regionOcr.width, Math.round(region.width * display.scaleFactor))
  assert.equal(regionOcr.height, Math.round(region.height * display.scaleFactor))
  assert.equal(regionOcr.png, undefined)
  assert.equal(regionOcr.snapshot, undefined)
  console.log('One-shot region capture and OCR passed without PNG or an image handle')
  const captured = await api.captureScreenRegion(
    display.id,
    region.x,
    region.y,
    region.width,
    region.height
  )
  assert.ok(Buffer.isBuffer(captured.png))
  const progress = new BrowserWindow({
    x: region.x + 30,
    y: region.y + 160,
    width: 600,
    height: 100,
    frame: false,
    hasShadow: false,
    backgroundColor: '#ffffff'
  })
  windows.push(progress)
  progress.setAlwaysOnTop(true, 'screen-saver')
  await progress.loadURL(
    'data:text/html,<body style="background:white;font:40px Arial">IGNORE PROGRESS</body>'
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  // OCR reads the earlier PNG after the progress window appears on screen.
  const output = await api.recognizeMacText(captured.png, ['en-US'])
  const recognized = output.observations.map((line) => line.text).join(' ')
  assert.match(recognized, /Hello Dictol/i)
  assert.doesNotMatch(recognized, /IGNORE PROGRESS/i)
  const control = await api.captureScreenRegion(
    display.id,
    region.x,
    region.y,
    region.width,
    region.height
  )
  const controlOcr = await api.recognizeMacText(control.png, ['en-US'])
  assert.match(
    controlOcr.observations.map((line) => line.text).join(' '),
    /IGNORE PROGRESS/i,
    'A new capture must contain the overlapping progress window'
  )
  console.log('PNG capture passed: progress shown after capture does not enter OCR input')
}

main().then(
  () => finish(0),
  (error) => {
    console.error(error)
    finish(1)
  }
)
function finish(code) {
  clearTimeout(timeout)
  for (const window of windows) if (!window.isDestroyed()) window.destroy()
  rmSync(userData, { recursive: true, force: true })
  app.exit(code)
}
