const addonPath = `./prebuilds/${process.platform}-${process.arch}/accessibility.node`
const addon = require(addonPath)

if (typeof addon.readAccessibleText !== 'function') {
  throw new Error(`Accessibility addon does not export readAccessibleText: ${addonPath}`)
}

module.exports = {
  readAccessibleText: addon.readAccessibleText
}
