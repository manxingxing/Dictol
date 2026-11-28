if (!['darwin', 'win32'].includes(process.platform)) {
  module.exports = {}
} else {
  const addonPath = `./prebuilds/${process.platform}-${process.arch}/ocr.node`
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
          'captureAndRecognizeMacText',
          'captureMacOcrImage',
          'chineseWordRange'
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
          'captureWindowsOcrImage'
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
  const wrapMacImage = (image) => ({
    width: image.width,
    height: image.height,
    recognize: async (region, languages, recognitionMode) =>
      parseMacOcr(await image.recognize(region, languages, recognitionMode)),
    dispose: () => image.dispose()
  })
  const macOcr =
    process.platform === 'darwin'
      ? {
          recognizeMacText: async (png, languages, recognitionMode) =>
            parseMacOcr(await addon.recognizeMacPng(png, languages, recognitionMode)),
          captureMacOcrImage: async (...args) =>
            wrapMacImage(await addon.captureMacOcrImage(...args)),
          captureAndRecognizeMacText: async (
            displayId,
            x,
            y,
            width,
            height,
            languages,
            recognitionMode
          ) => {
            const output = await addon.captureAndRecognizeMacText(
              displayId,
              x,
              y,
              width,
              height,
              languages,
              recognitionMode
            )
            return { ...parseMacOcr(output.json), width: output.width, height: output.height }
          }
        }
      : {}
  module.exports = {
    ...addon,
    ...macOcr,
    getPermissionStatus,
    openPermissionSettings
  }
}
