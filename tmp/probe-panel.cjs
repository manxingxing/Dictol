// Temporary runtime probe: verifies that the native macOS auxiliary-window policy
// actually flips AppKit's `_isNonactivatingPanel` bit on a real Electron window.
// Run with: node_modules/.bin/electron tmp/probe-panel.cjs
const { app, BrowserWindow } = require('electron')
const { applyMacosAuxiliaryWindowPolicy } = require('@dictol/mdict-native')

const describe = (behavior) => ({
  value: behavior,
  canJoinAllSpaces: (behavior & 1) !== 0,
  moveToActiveSpace: (behavior & 2) !== 0,
  transient: (behavior & 8) !== 0,
  fullScreenAuxiliary: (behavior & 256) !== 0
})

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    hiddenInMissionControl: true,
    alwaysOnTop: true,
    show: false
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.showInactive()

  const before = win.getNativeWindowHandle
    ? null
    : null
  const result = applyMacosAuxiliaryWindowPolicy(win.getNativeWindowHandle(), {
    activationIndependent: true,
    joinAllSpaces: false,
    moveToActiveSpace: true,
    fullScreenAuxiliary: true
  })

  console.log('PROBE_RESULT ' + JSON.stringify({
    before: before,
    result,
    beforeBits: describe(result.collectionBehaviorBefore),
    afterBits: describe(result.collectionBehaviorAfter),
    hasStyleMaskTitled: (result.styleMask & 1) !== 0,
    hasNonactivatingPanelMask: (result.styleMask & 128) !== 0
  }))

  setTimeout(() => app.quit(), 300)
})
