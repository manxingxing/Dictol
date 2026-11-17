/* eslint-disable @typescript-eslint/no-require-imports */
const { app } = require('electron')
const { mkdtempSync, rmSync } = require('node:fs')
const Module = require('node:module')
const { tmpdir } = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')
const sharp = require('sharp')

const root = process.cwd()
const userData = mkdtempSync(path.join(tmpdir(), 'dictol-screenshot-ocr-'))
app.setPath('userData', userData)
app.getAppPath = () => root
const timeout = setTimeout(() => {
  console.error('截图 OCR 测试超时。')
  app.exit(1)
}, 30000)

app
  .whenReady()
  .then(async () => {
    const bundled = await esbuild.build({
      entryPoints: [path.join(root, 'src/main/ocr/screenshot-ocr.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron', '@dictol/ocr-native', 'rapidocr-node'],
      write: false
    })
    // Match the built worker's location without writing generated source into the project.
    const filename = path.join(root, 'out/main/screenshot-ocr-smoke.cjs')
    const compiled = new Module(filename, module)
    compiled.filename = filename
    compiled.paths = Module._nodeModulePaths(path.dirname(filename))
    compiled._compile(bundled.outputFiles[0].text, filename)
    const png = await sharp(
      Buffer.from(
        '<svg width="640" height="130"><rect width="100%" height="100%" fill="white"/>' +
          '<text x="20" y="85" font-size="55" font-family="sans-serif">Hello world</text></svg>'
      )
    )
      .png()
      .toBuffer()
    for (const engine of ['system', 'paddle']) {
      const text = await compiled.exports.recognizeScreenshotText(engine, png)
      if (!/Hello\s+world/i.test(text)) throw new Error(`${engine} OCR 输出不符合预期：${text}`)
      console.log(`${engine}: ${text}`)
    }
    clearTimeout(timeout)
    rmSync(userData, { recursive: true, force: true })
    app.exit(0)
  })
  .catch((error) => {
    clearTimeout(timeout)
    console.error(error)
    rmSync(userData, { recursive: true, force: true })
    app.exit(1)
  })
