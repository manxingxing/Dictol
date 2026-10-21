if (!['darwin', 'win32'].includes(process.platform)) {
  module.exports = {}
} else {
  const addonPath = `./prebuilds/${process.platform}-${process.arch}/screen-capture.node`
  const addon = require(addonPath)

  const requiredExports =
    process.platform === 'darwin'
      ? ['captureScreenRegion', 'hasScreenCapturePermission']
      : [
          'captureWindowsDisplayAtPoint',
          'captureWindowsScreenRegion',
          'getWindowsDisplayBoundsAtPoint',
          'stopWindowsScreenCaptureSessions'
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

  module.exports = { ...addon, getPermissionStatus, openPermissionSettings }
}
