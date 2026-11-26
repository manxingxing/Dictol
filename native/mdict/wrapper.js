/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const path = require('node:path')
const fs = require('node:fs')

const nativeTargets = {
  darwin: {
    x64: ['darwin-x64', 'darwin-x64'],
    arm64: ['darwin-arm64', 'darwin-arm64']
  },
  win32: {
    x64: ['win32-x64', 'win32-x64-msvc']
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

const native = require(bindingPath)

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
