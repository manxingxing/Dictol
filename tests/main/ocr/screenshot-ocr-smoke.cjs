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
}, 120000)

app
  .whenReady()
  .then(async () => {
    const bundled = await esbuild.build({
      entryPoints: [path.join(root, 'src/main/ocr/screenshot-ocr.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron', '@dictol/ocr-native'],
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
        '<svg width="1600" height="650"><rect width="100%" height="100%" fill="white"/>' +
          [
            'Hello world',
            '中文文字识别',
            '繁體中文辨識',
            '日本語の文字認識',
            'Bonjour, je parle français.',
            '안녕하세요 한국어 문자 인식',
            'Guten Tag, schöne Grüße.'
          ]
            .map(
              (line, index) =>
                `<text x="30" y="${70 + index * 80}" font-size="48" font-family="sans-serif">${line}</text>`
            )
            .join('') +
          '</svg>'
      )
    )
      .png()
      .toBuffer()
    const text = await compiled.exports.recognizeScreenshotText(png)
    for (const expected of [
      /Hello\s+world/i,
      /中文/,
      /繁體/,
      /日本語/,
      /français/i,
      /한국어/,
      /Grüße/i
    ]) {
      if (!expected.test(text)) throw new Error(`系统 OCR 未识别预期文字 ${expected}：${text}`)
    }
    console.log(`System OCR: ${text}`)
    if (process.platform === 'darwin') {
      const fastText = await compiled.exports.recognizeScreenshotText(png, {
        engine: 'system',
        recognitionMode: 'fast'
      })
      if (
        !/Hello\s+world/i.test(fastText) ||
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(fastText)
      ) {
        throw new Error(`快速 OCR 语言结果不符预期：${fastText}`)
      }
      console.log(`Fast OCR: ${fastText}`)
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
