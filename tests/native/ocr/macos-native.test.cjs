const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

test(
  'macOS native capture exports PNG and recognizes text with character geometry',
  {
    skip: process.platform !== 'darwin'
  },
  async () => {
    const root = path.resolve(__dirname, '../../..')
    const source = path.join(root, 'native/ocr/macos/src')
    const temp = mkdtempSync(path.join(tmpdir(), 'dictol-native-ocr-'))
    try {
      const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
        encoding: 'utf8'
      }).trim()
      const include = path.resolve(path.dirname(process.execPath), '../include/node')
      const objects = ['addon.mm', 'ocr.m', 'word_tokenizer.m', 'macos-capture-fixture.m'].map(
        (file) => {
          const output = path.join(temp, `${file}.o`)
          execFileSync(file.endsWith('.mm') ? 'clang++' : 'clang', [
            ...(file.endsWith('.mm') ? ['-std=c++17'] : []),
            '-c',
            file.startsWith('macos-capture') ? path.join(__dirname, file) : path.join(source, file),
            '-o',
            output,
            '-isysroot',
            sdk,
            '-mmacosx-version-min=13.0',
            '-fvisibility=hidden',
            '-fobjc-arc',
            '-fblocks',
            `-I${source}`,
            `-I${include}`,
            '-DNODE_GYP_MODULE_NAME=ocr_fixture'
          ])
          return output
        }
      )
      const binary = path.join(temp, 'fixture.node')
      execFileSync('clang++', [
        '-bundle',
        '-undefined',
        'dynamic_lookup',
        ...objects,
        ...['Foundation', 'CoreGraphics', 'Vision', 'ImageIO', 'NaturalLanguage'].flatMap(
          (name) => ['-framework', name]
        ),
        '-o',
        binary
      ])
      execFileSync('codesign', ['--force', '--sign', '-', binary])
      const api = require(binary)
      const displays = await api.listShareableDisplays()
      const windows = await api.listShareableWindows()
      assert.equal(displays[0].id, 101)
      assert.equal(windows[0].id, 202)
      assert.equal(windows[0].title, 'Fixture window')
      assert.equal(windows[0].isOnScreen, true)
      const sharp = require('sharp')
      const textPng = await sharp(
        Buffer.from(
          '<svg width="800" height="160"><rect width="800" height="160" fill="white"/><text x="30" y="100" font-family="Arial" font-size="60" fill="black">Hello Dictol</text></svg>'
        )
      )
        .png()
        .toBuffer()
      const textResult = JSON.parse(await api.recognizeMacPng(textPng, ['en-US']))
      assert.match(textResult.observations.map((item) => item.text).join(' '), /Hello Dictol/i)
      for (const line of textResult.observations) {
        assert.ok(line.characters.length > 0)
        assert.equal(line.quad.length, 4)
        for (const character of line.characters) {
          assert.ok(character.start >= 0 && character.length > 0)
          assert.equal(character.quad.length, 4)
        }
      }
      // Different fixture sizes verify that each Node API reaches its own native entry.
      const png = await api.captureDisplay(1)
      assert.deepEqual([png.width, png.height], [200, 100])
      const regionImage = await api.captureScreenRegion(1, 10, 20, 30, 40)
      assert.deepEqual([regionImage.width, regionImage.height], [30, 40])
      const windowImage = await api.captureWindow(1)
      assert.deepEqual([windowImage.width, windowImage.height], [160, 80])
      for (const image of [png, regionImage, windowImage]) {
        assert.equal(image.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      }
      assert.deepEqual(JSON.parse(await api.recognizeMacPng(png.png, ['en-US'])), {
        observations: []
      })
      assert.deepEqual(api.chineseWordRange('hello world', 7), { start: 6, length: 5 })
      assert.equal(api.chineseWordRange('hello', 20), null)
      const recognized = await api.captureAndRecognizeMacText(1, 10, 20, 200, 100, ['en-US'])
      assert.deepEqual([recognized.width, recognized.height], [200, 100])
      assert.deepEqual(JSON.parse(recognized.json), { observations: [] })
      assert.equal(recognized.png, undefined)
      assert.equal(recognized.snapshot, undefined)
      await assert.rejects(
        () => api.captureAndRecognizeMacText(4294967295, 0, 0, 200, 100, ['en-US']),
        { code: 'ERR_SCREEN_CAPTURE', message: 'Fixture display was not found' }
      )
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
)

test(
  'macOS 13 frame receiver ignores incomplete frames and owns completed pixels',
  {
    skip: process.platform !== 'darwin'
  },
  () => {
    const source = path.resolve(__dirname, '../../../native/ocr/macos/src')
    const temp = mkdtempSync(path.join(tmpdir(), 'dictol-stream-frame-'))
    try {
      const binary = path.join(temp, 'stream-frame')
      execFileSync('clang', [
        '-fobjc-arc',
        '-fblocks',
        '-mmacosx-version-min=13.0',
        `-I${source}`,
        path.join(__dirname, 'macos-stream-frame.m'),
        ...[
          'Foundation',
          'CoreGraphics',
          'ScreenCaptureKit',
          'CoreMedia',
          'CoreVideo',
          'CoreImage'
        ].flatMap((name) => ['-framework', name]),
        '-o',
        binary
      ])
      execFileSync(binary, [])
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
)

test(
  'macOS stream stops once across callback ordering, failures and late startup',
  {
    skip: process.platform !== 'darwin'
  },
  () => {
    const source = path.resolve(__dirname, '../../../native/ocr/macos/src')
    const temp = mkdtempSync(path.join(tmpdir(), 'dictol-stream-lifecycle-'))
    try {
      const binary = path.join(temp, 'stream-lifecycle')
      execFileSync('clang', [
        '-fobjc-arc',
        '-fblocks',
        '-mmacosx-version-min=13.0',
        `-I${source}`,
        path.join(__dirname, 'macos-stream-lifecycle.m'),
        ...[
          'Foundation',
          'CoreGraphics',
          'ScreenCaptureKit',
          'CoreMedia',
          'CoreVideo',
          'CoreImage'
        ].flatMap((name) => ['-framework', name]),
        '-o',
        binary
      ])
      for (const scenario of [
        'frame-before-start',
        'frame-after-start',
        'start-error',
        'stop-error',
        'start-timeout',
        'frame-timeout'
      ]) {
        execFileSync(binary, [scenario], { timeout: 15000 })
      }
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
)
