import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import native from '../native/mdict-node/wrapper.js'

const input = process.argv[2]
if (process.platform !== 'darwin' || !input) {
  console.error('Usage on macOS: node scripts/compare-macos-ocr.mjs <ocr-diagnostic.json>')
  process.exit(1)
}

const metadataPath = resolve(input)
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
const png = await readFile(metadataPath.replace(/\.json$/u, '.png'))
const pointer = metadata.pointerInImage
const hoveredLine = (observations) =>
  observations.find(
    (item) =>
      pointer.x >= item.x &&
      pointer.x <= item.x + item.width &&
      pointer.y >= 1 - item.y - item.height &&
      pointer.y <= 1 - item.y
  )

console.log(
  JSON.stringify({
    profile: 'captured-app-ocr',
    hoveredLine: hoveredLine(metadata.observations)?.text ?? null,
    selectedWord: metadata.selected?.selection.word ?? null,
    observations: metadata.observations.length
  })
)

const profiles = [
  ['default', ['ja-JP', 'zh-Hans', 'en-US', 'zh-Hant']],
  ['simplified-chinese', ['zh-Hans']],
  ['japanese', ['ja-JP']],
  ['english', ['en-US']]
]

for (const [name, languages] of profiles) {
  const started = performance.now()
  const result = await native.recognizeMacText(png, languages, true)
  const line = hoveredLine(result.observations)
  console.log(
    JSON.stringify({
      profile: name,
      languages,
      ocrMs: Math.round(performance.now() - started),
      hoveredLine: line?.text ?? null,
      confidence: line?.confidence ?? null,
      observations: result.observations.length
    })
  )
}
