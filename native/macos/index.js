/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const path = require('node:path')

// This package is imported by shared window-management code on Windows too.
// Resolve the macOS binary only when a panel function is actually called.
let binding
function native() {
  if (process.platform !== 'darwin') throw new Error('Native panels require macOS')
  if (!['arm64', 'x64'].includes(process.arch))
    throw new Error(`Unsupported macOS architecture: ${process.arch}`)
  return (binding ??= require(
    path.join(__dirname, 'prebuilds', `darwin-${process.arch}`, 'macos.node')
  ))
}
module.exports.configureElectronPanel = (handle) => {
  const addon = native()
  try {
    addon.configureElectronPanel(handle)
  } catch (error) {
    if (
      error instanceof Error &&
      process.versions.electron &&
      error.code?.startsWith('ERR_PANEL_')
    ) {
      error.message += ` (Electron ${process.versions.electron})`
    }
    throw error
  }
}
module.exports.createSelectionPanel = (...args) => native().createSelectionPanel(...args)
module.exports.destroySelectionPanel = (...args) => native().destroySelectionPanel(...args)
module.exports.showSelectionPanel = (...args) => native().showSelectionPanel(...args)
module.exports.hideSelectionPanel = (...args) => native().hideSelectionPanel(...args)
module.exports.showSelectionPanelDisableMenu = (...args) =>
  native().showSelectionPanelDisableMenu(...args)
module.exports.selectionPanelState = (...args) => native().selectionPanelState(...args)
module.exports.getSelectionPanelBounds = (...args) => native().getSelectionPanelBounds(...args)
module.exports.setSelectionPanelBounds = (...args) => native().setSelectionPanelBounds(...args)
