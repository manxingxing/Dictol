if (!['darwin', 'win32'].includes(process.platform)) {
  module.exports = {}
} else {
  const addonPath = `./prebuilds/${process.platform}-${process.arch}/ocr.node`
  const addon = require(addonPath)

  if (process.platform === 'darwin') {
    for (const name of ['recognizeMacText', 'chineseWordRange']) {
      if (typeof addon[name] !== 'function') {
        throw new Error(`OCR addon does not export ${name}: ${addonPath}`)
      }
    }
    module.exports = {
      recognizeMacText: async (png, languages, accurate) => {
        const result = await addon.recognizeMacText(png, languages, accurate)
        if (result.error) throw new Error(result.error)
        return result
      },
      chineseWordRange: addon.chineseWordRange
    }
  } else {
    if (typeof addon.recognizeWindowsText !== 'function') {
      throw new Error(`OCR addon does not export recognizeWindowsText: ${addonPath}`)
    }
    module.exports = { recognizeWindowsText: addon.recognizeWindowsText }
  }
}
