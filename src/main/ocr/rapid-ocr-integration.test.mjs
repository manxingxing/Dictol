import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import sharp from 'sharp'
import { selectOcrTextHit } from './ocr-text.ts'
import { screenshotTranslationText } from './ocr-translation.ts'

test('Worker reports stage timings and reuses its loaded model', { timeout: 30000 }, async () => {
  const png = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: 'white' }
  })
    .png()
    .toBuffer()
  const worker = new Worker(resolve('out/main/rapid-ocr-worker.js'), {
    workerData: { modelDirectory: resolve('resources/rapidocr'), intraOpNumThreads: 2 }
  })
  try {
    const send = (id) =>
      new Promise((resolveResponse, reject) => {
        worker.once('message', resolveResponse)
        worker.once('error', reject)
        worker.postMessage({ id, png, includeLowConfidenceLines: false, recognitionOnly: false })
      })
    const first = await send(1)
    const second = await send(2)
    assert.equal(first.error, undefined)
    assert.equal(second.error, undefined)
    for (const response of [first, second]) {
      const timing = response.result.timings
      for (const key of [
        'queueMs',
        'modelLoadMs',
        'preprocessMs',
        'inferenceMs',
        'postprocessMs'
      ]) {
        assert.ok(Number.isFinite(timing[key]) && timing[key] >= 0, `${key} must be nonnegative`)
      }
      assert.deepEqual(timing.originalSize, { width: 1200, height: 600 })
      assert.deepEqual(timing.inferenceSize, { width: 1200, height: 600 })
    }
    assert.equal(second.result.timings.modelLoadMs, 0)
  } finally {
    await worker.terminate()
  }
})

test('RapidOCR character boxes locate text in a recognized image', { timeout: 30000 }, async () => {
  const png = await sharp(
    Buffer.from(
      '<svg width="640" height="130"><rect width="100%" height="100%" fill="white"/>' +
        '<text x="20" y="85" font-size="55" font-family="sans-serif">Hello world</text></svg>'
    )
  )
    .png()
    .toBuffer()
  const observations = await recognize(png)
  const line = observations.find((item) => item.text.includes('Hello'))
  assert.ok(line, 'RapidOCR should detect the generated text')
  const offset = line.text.indexOf('Hello')
  const character = line.characters.find(
    (box) => box.start <= offset && box.start + box.length > offset
  )
  assert.ok(character, 'the text should have a character box')
  const hit = selectOcrTextHit(
    observations,
    { x: character.x + character.width / 2, y: 1 - character.y - character.height / 2 },
    640 / 130
  )
  assert.equal(hit?.selection.word, 'Hello')
  assert.match(screenshotTranslationText(observations), /Hello\s+world/)
})

test('RapidOCR locates words in a wide image', { timeout: 30000 }, async () => {
  const png = await sharp(
    Buffer.from(
      '<svg width="5120" height="1200"><rect width="100%" height="100%" fill="white"/>' +
        '<text x="1200" y="600" font-size="60" font-family="sans-serif">Hello world</text></svg>'
    )
  )
    .png()
    .toBuffer()
  const observations = await recognize(png)
  const hit = selectOcrTextHit(observations, { x: 1218 / 5120, y: 580 / 1200 }, 5120 / 1200)
  assert.equal(hit?.selection.word, 'Hello')
  assert.ok(hit.bounds.x * 5120 > 1180 && hit.bounds.x * 5120 < 1230)
  assert.ok(hit.bounds.y * 1200 < 600 && (hit.bounds.y + hit.bounds.height) * 1200 > 580)
})

test('RapidOCR preserves normalized coordinates in a large image', { timeout: 30000 }, async () => {
  const png = await sharp(
    Buffer.from(
      '<svg width="2880" height="1800"><rect width="100%" height="100%" fill="white"/>' +
        '<text x="400" y="900" font-size="180" font-family="sans-serif">Hello world</text></svg>'
    )
  )
    .png()
    .toBuffer()
  const observations = await recognize(png)
  const line = observations.find((item) => item.text.includes('Hello'))
  assert.ok(line, 'RapidOCR should detect the generated text')
  assert.ok(line.x > 0.1 && line.x < 0.2, `unexpected normalized x: ${line.x}`)
  assert.ok(line.y > 0.4 && line.y < 0.55, `unexpected normalized y: ${line.y}`)
  assert.match(screenshotTranslationText(observations), /Hello\s+world/)
})

test(
  'RapidOCR recognizes a Chinese, English, and Japanese sample',
  {
    timeout: 30000,
    skip: process.platform !== 'darwin'
  },
  async () => {
    const png = await sharp(
      Buffer.from(
        '<svg width="900" height="260"><rect width="100%" height="100%" fill="white"/>' +
          '<g font-size="42" font-family="PingFang SC, Hiragino Sans, Arial, sans-serif" fill="black">' +
          '<text x="25" y="65">中文识别测试</text><text x="25" y="135">English text example</text>' +
          '<text x="25" y="205">日本語の文字認識</text></g></svg>'
      )
    )
      .png()
      .toBuffer()
    const text = screenshotTranslationText(await recognize(png))
    assert.match(text, /中文识别测试/)
    assert.match(text, /English text example/)
    assert.match(text, /日本語の文字認識/)
  }
)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function recognize(png) {
  const worker = new Worker(resolve('out/main/rapid-ocr-worker.js'), {
    workerData: { modelDirectory: resolve('resources/rapidocr'), intraOpNumThreads: 2 }
  })
  try {
    const response = await new Promise((resolveResponse, reject) => {
      worker.once('message', resolveResponse)
      worker.once('error', reject)
      worker.postMessage({ id: 1, png, includeLowConfidenceLines: false, recognitionOnly: false })
    })
    assert.equal(response.error, undefined)
    return response.result.observations
  } finally {
    await worker.terminate()
  }
}
