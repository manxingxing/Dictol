class ScreenCaptureError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ScreenCaptureError'
  }
}

if (!['darwin', 'win32'].includes(process.platform)) {
  module.exports = { ScreenCaptureError }
} else {
  const addonPath = `./prebuilds/${process.platform}-${process.arch}/screen-capture.node`
  const addon = require(addonPath)

  const requiredExports =
    process.platform === 'darwin'
      ? [
          'captureScreenRegion',
          'captureDisplay',
          'captureWindow',
          'listShareableDisplays',
          'listShareableWindows',
          'hasScreenCapturePermission',
          'recognizeMacPng',
          'chineseWordRange',
          'captureAndRecognizeMacText',
          'recognizeMacSnapshot',
          'releaseMacSnapshot'
        ]
      : [
          'captureScreenRegion',
          'captureDisplay',
          'captureWindow',
          'listShareableDisplays',
          'listShareableWindows',
          'getWindowsDisplayBoundsAtPoint',
          'recognizeWindowsText',
          'captureAndRecognizeWindowsText',
          'recognizeWindowsSnapshot',
          'releaseWindowsSnapshot'
        ]

  for (const name of requiredExports) {
    if (typeof addon[name] !== 'function') {
      throw new Error(`Screen capture addon does not export ${name}: ${addonPath}`)
    }
  }

  const getPermissionStatus = () => {
    if (process.platform !== 'darwin') return 'not-required'
    return addon.hasScreenCapturePermission() ? 'granted' : 'not-granted'
  }

  const openPermissionSettings = async () => {
    if (process.platform !== 'darwin') throw new Error('Screen capture settings require macOS')
    const settingsUrl =
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    const { execFile } = require('node:child_process')
    await new Promise((resolve, reject) => {
      execFile('/usr/bin/open', [settingsUrl], (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  const parseMacOcr = (json) => {
    const result = JSON.parse(json)
    if (result.error) throw new Error(result.error)
    return result
  }
  const captureOcr = async (fn, args, mac) => {
    let output
    try {
      output = await fn(...args)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('DICTOL_CAPTURE_ERROR: ')) {
        throw new ScreenCaptureError(error.message.slice('DICTOL_CAPTURE_ERROR: '.length))
      }
      throw error
    }
    if (!mac) return output
    try {
      return { ...output, result: parseMacOcr(output.json) }
    } catch (error) {
      addon.releaseMacSnapshot(output.snapshot)
      throw error
    }
  }
  const macOcr =
    process.platform === 'darwin'
      ? {
          recognizeMacText: async (png, languages, autoDetect = false) =>
            parseMacOcr(await addon.recognizeMacPng(png, languages, autoDetect)),
          captureAndRecognizeMacText: (...args) =>
            captureOcr(addon.captureAndRecognizeMacText, args, true),
          recognizeMacSnapshot: async (...args) => {
            const output = await addon.recognizeMacSnapshot(...args)
            return { ...output, result: parseMacOcr(output.json) }
          }
        }
      : {
          captureAndRecognizeWindowsText: (...args) =>
            captureOcr(addon.captureAndRecognizeWindowsText, args, false)
        }
  module.exports = {
    ...addon,
    ...macOcr,
    ScreenCaptureError,
    getPermissionStatus,
    openPermissionSettings
  }
}
