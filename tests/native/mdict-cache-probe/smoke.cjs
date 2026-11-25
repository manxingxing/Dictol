const assert = require('node:assert/strict')
const { readdirSync } = require('node:fs')
const path = require('node:path')

async function main() {
  const [bindingPath, mdxPath] = process.argv.slice(2)
  if (!bindingPath || !mdxPath || process.argv.length !== 4) {
    throw new Error('Usage: node smoke.cjs <binding.node> <dictionary.mdx>')
  }
  const { Mdx, Mdd, MddList } = require(path.resolve(bindingPath))
  const previousOptions = {
    keyBlocksCacheBytes: 32 * 1024 * 1024,
    recordBlocksCacheBytes: 64 * 1024 * 1024
  }
  const noRecordCacheOptions = { recordBlocksCacheBytes: 0 }
  const dictionaries = []
  try {
    const reference = Mdx.open(mdxPath, previousOptions)
    const current = Mdx.open(mdxPath)
    dictionaries.push(reference, current)
    const samples = await reference.keys().nextBatch(12)
    assert.ok(samples.entries.length > 0)
    for (const entry of samples.entries) {
      const expected = await reference.readRecord(entry.recordStart, entry.recordEnd)
      assert.deepEqual(await current.readRecord(entry.recordStart, entry.recordEnd), expected)
      assert.deepEqual(await current.readRecord(entry.recordStart, entry.recordEnd), expected)
    }
    console.log(`MDX: ${samples.entries.length} records match before/after repeated reads`)

    const directory = path.dirname(mdxPath)
    const baseName = path.basename(mdxPath, path.extname(mdxPath))
    const resourceFiles = readdirSync(directory).filter(
      (name) =>
        name === `${baseName}.mdd` ||
        (name.startsWith(`${baseName}.`) && /^\d+\.mdd$/i.test(name.slice(baseName.length + 1)))
    )
    assert.ok(resourceFiles.length > 0, 'No companion MDD files found')
    for (const fileName of resourceFiles) {
      const filePath = path.join(directory, fileName)
      const source = Mdd.open(filePath, noRecordCacheOptions)
      const previous = MddList.open([filePath], previousOptions)
      const uncached = MddList.open([filePath], noRecordCacheOptions)
      dictionaries.push(source, previous, uncached)
      const batch = await source.keys().nextBatch(8)
      assert.ok(batch.entries.length > 0)
      for (const entry of batch.entries) {
        const expected = await previous.readRecord(0, entry.recordStart, entry.recordEnd)
        assert.deepEqual(await uncached.readRecord(0, entry.recordStart, entry.recordEnd), expected)
        assert.deepEqual(await uncached.readRecord(0, entry.recordStart, entry.recordEnd), expected)
      }
      console.log(`${fileName}: ${batch.entries.length} resources match with Record cache disabled`)
    }
  } finally {
    // Completed scanner tasks must be collected before deterministic native close.
    await new Promise(setImmediate)
    global.gc?.()
    await new Promise(setImmediate)
    for (const dictionary of dictionaries) assert.equal(dictionary.close(), true)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
