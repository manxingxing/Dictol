const native = require('./index.js')

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
