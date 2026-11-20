// Manual probe using synthetic text only; run with Node or Electron to compare hosts.
const sharp = require('sharp')
const api = require('../../../native/ocr')

async function main() {
  if (process.versions.electron) await require('electron').app.whenReady()
  console.error(new Date().toISOString(), 'probe start', {
    pid: process.pid,
    host: process.versions.electron ? 'electron' : 'node'
  })
  const png = await sharp(
    Buffer.from(
      '<svg width="1400" height="600"><rect width="1400" height="600" fill="white"/>' +
        '<text x="30" y="100" font-family="Arial" font-size="48">Hello Dictol screenshot translation</text>' +
        '<text x="30" y="200" font-family="sans-serif" font-size="48">中文识别 日本語のテスト</text></svg>'
    )
  )
    .png()
    .toBuffer()
  for (const languages of [['en-US', 'zh-Hans', 'ja-JP', 'zh-Hant'], ['en-US']]) {
    const startedAt = performance.now()
    console.error(new Date().toISOString(), 'recognize begin', languages)
    const result = await api.recognizeMacText(png, languages)
    console.error(new Date().toISOString(), 'recognize end', {
      elapsedMs: Math.round(performance.now() - startedAt),
      observations: result.observations.length
    })
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
