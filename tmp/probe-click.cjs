// Temporary experiment harness: does clicking an auxiliary window activate Dictol?
//
// Creates a window per strategy, moves frontmost-app ownership to Finder, posts a
// real click at the window's centre, and reports whether the app got activated
// and whether the click actually reached the window.
//
// Run: node_modules/.bin/electron tmp/probe-click.cjs
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const { applyMacosAuxiliaryWindowPolicy } = require('@dictol/mdict-native')

const CLICK_TOOL = '/tmp/dictol-click'
const WINDOW_BOUNDS = { x: 300, y: 200, width: 400, height: 300 }
const CLICK_POINT = [500, 350]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const frontApp = () => {
  try {
    const asn = execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim()
    const info = execFileSync('lsappinfo', ['info', '-only', 'name', asn], { encoding: 'utf8' }).trim()
    const name = info.includes('=') ? info.slice(info.lastIndexOf('=') + 1).replace(/"/g, '') : asn
    return `${name} [${asn.slice(0, 14)}]`
  } catch (error) {
    return `unknown (${error.message})`
  }
}

const activateFinder = () => {
  execFileSync('osascript', ['-e', 'tell application "Finder" to activate'])
}

const HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
<html><body style="margin:0;background:rgb(51,170,85)">
<div style="width:100vw;height:100vh"></div>
<script>
let hits = 0
document.addEventListener('mousedown', () => { hits++ }, true)
window.__hits = () => hits
</script></body></html>`)}`

let becameActiveCount = 0
app.on('did-become-active', () => {
  becameActiveCount += 1
})

async function runMode(mode) {
  const [policyMode, focusability] = mode.split('-')
  const options = {
    ...WINDOW_BOUNDS,
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hiddenInMissionControl: true,
    ...(focusability === 'nofocus' ? { focusable: false, acceptFirstMouse: true } : {}),
    ...(policyMode === 'panel' ? { type: 'panel' } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  }

  const window = new BrowserWindow(options)
  await window.loadURL(HTML)
  window.setAlwaysOnTop(true, 'screen-saver')

  let policy = null
  if (policyMode === 'policy') {
    policy = applyMacosAuxiliaryWindowPolicy(window.getNativeWindowHandle(), {
      activationIndependent: true,
      joinAllSpaces: false,
      moveToActiveSpace: true,
      fullScreenAuxiliary: true
    })
  }

  window.showInactive()
  window.setBounds(WINDOW_BOUNDS)
  await sleep(400)

  activateFinder()
  await sleep(400)
  const frontBefore = frontApp()
  const activeBefore = becameActiveCount

  execFileSync(CLICK_TOOL, CLICK_POINT.map(String))
  await sleep(600)

  const frontAfter = frontApp()
  const activated = becameActiveCount > activeBefore
  const hits = await window.webContents.executeJavaScript('window.__hits()')

  window.hide()
  await sleep(200)

  return {
    mode,
    frontBefore,
    frontAfter,
    activated,
    clickDelivered: hits > 0,
    policyApplied: policy ? policy.applied : null
  }
}

app.whenReady().then(async () => {
  const results = []
  for (const mode of ['plain', 'plain-nofocus', 'panel', 'policy', 'policy-nofocus']) {
    try {
      results.push(await runMode(mode))
    } catch (error) {
      results.push({ mode, error: String(error) })
    }
  }
  console.log(`PROBE_RESULT ${JSON.stringify(results, null, 2)}`)
  app.exit(0)
})
