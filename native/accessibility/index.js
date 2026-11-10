const addonPath = `./prebuilds/${process.platform}-${process.arch}/accessibility.node`
const addon = require(addonPath)

if (typeof addon.readAccessibleText !== 'function') {
  throw new Error(`Accessibility addon does not export readAccessibleText: ${addonPath}`)
}

module.exports = {
  readAccessibleText: addon.readAccessibleText,
  readAccessibleSelection: (includeContext) => {
    if (process.platform !== 'darwin') {
      throw new Error('readAccessibleSelection is only supported on macOS')
    }
    return addon.readAccessibleSelection(includeContext)
  }
}
