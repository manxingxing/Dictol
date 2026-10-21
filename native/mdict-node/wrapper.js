const path = require('node:path')
const fs = require('node:fs')

const nativeTargets = {
  darwin: {
    x64: ['darwin-x64', 'darwin-x64'],
    arm64: ['darwin-arm64', 'darwin-arm64']
  },
  win32: {
    x64: ['win32-x64', 'win32-x64-msvc']
  },
  linux: {
    x64: ['linux-x64-gnu', 'linux-x64-gnu'],
    arm64: ['linux-arm64-gnu', 'linux-arm64-gnu']
  }
}

const target = nativeTargets[process.platform]?.[process.arch]
if (!target) {
  throw new Error(`Unsupported mdict native target: ${process.platform}-${process.arch}`)
}

const bindingPath = path.join(
  __dirname,
  'prebuilds',
  target[0],
  `dictol-mdict-node.${target[1]}.node`
)
if (!fs.existsSync(bindingPath)) {
  throw new Error(
    `Missing mdict native prebuild for ${process.platform}-${process.arch}: ${bindingPath}`
  )
}

const previousBindingPath = process.env.NAPI_RS_NATIVE_LIBRARY_PATH
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = bindingPath
let native
try {
  native = require('./index.js')
} finally {
  if (previousBindingPath === undefined) delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH
  else process.env.NAPI_RS_NATIVE_LIBRARY_PATH = previousBindingPath
}

function addAsyncIterator(ScannerClass) {
  if (!ScannerClass) return
  ScannerClass.prototype[Symbol.asyncIterator] = async function* () {
    while (true) {
      const batch = await this.nextBatch()
      for (const entry of batch.entries) yield entry
      if (batch.done) return
    }
  }
}

addAsyncIterator(native.MdxKeyScanner)
addAsyncIterator(native.MdxEntryScanner)
addAsyncIterator(native.MddKeyScanner)
addAsyncIterator(native.MddEntryScanner)
addAsyncIterator(native.MddListKeyScanner)
addAsyncIterator(native.MddListEntryScanner)

module.exports = native
// 显式列出命名导出，确保 CommonJS 被 `await import()` 加载时也能得到
// `Mdx`、`Mdd`、`MddList` 等 named exports，而不只得到 default export。
module.exports.Mdd = native.Mdd
module.exports.MddEntryScanner = native.MddEntryScanner
module.exports.MddKeyScanner = native.MddKeyScanner
module.exports.MddList = native.MddList
module.exports.MddListEntryScanner = native.MddListEntryScanner
module.exports.MddListKeyScanner = native.MddListKeyScanner
module.exports.Mdx = native.Mdx
module.exports.MdxEntryScanner = native.MdxEntryScanner
module.exports.MdxKeyScanner = native.MdxKeyScanner
module.exports.hashFile = native.hashFile
module.exports.DidxIndex = native.DidxIndex
module.exports.Ld2 = native.Ld2
module.exports.createSelectionPanel = native.createSelectionPanel
module.exports.configureElectronPanel = native.configureElectronPanel
module.exports.destroySelectionPanel = native.destroySelectionPanel
module.exports.showSelectionPanel = native.showSelectionPanel
module.exports.showSelectionPanelDisableMenu = native.showSelectionPanelDisableMenu
module.exports.hideSelectionPanel = native.hideSelectionPanel
module.exports.selectionPanelState = native.selectionPanelState
module.exports.getSelectionPanelBounds = native.getSelectionPanelBounds
module.exports.setSelectionPanelBounds = native.setSelectionPanelBounds
