/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { addon } = require('./harness.cjs')
const { createCandidatesPair } = require('./candidates-harness.cjs')

async function main() {
  const [resultPath, outputPath] = process.argv.slice(2)
  if (!resultPath || !outputPath)
    throw new Error('Usage: diagnose-candidates.cjs RESULTS_JSON OUTPUT_JSON')
  const data = JSON.parse(readFileSync(resultPath, 'utf8'))
  const limit = 50
  const paths = data.indexes.map((index) => index.path)
  const pair = createCandidatesPair(paths)
  const indexes = paths.map((filename) => addon.DidxIndex.open(filename))
  const results = []
  try {
    for (const query of ['apple', 'hello', 'app', '中文']) {
      const normal = await pair.baseline.normalCandidates(query, limit)
      const globalNormal = pair.baseline.mergeCandidates(normal, limit, query)
      const dictionaries = []
      for (const [i, index] of indexes.entries()) {
        const [exact, loose, prefix] = await Promise.all([
          index.exact(query),
          index.loose(query, limit),
          index.prefix(query, limit)
        ])
        // Rust candidates() deduplicates display spellings before testing hits.len()
        // against limit. Sorting/truncation do not change this branch condition.
        const unique = new Set([...exact, ...loose, ...prefix].map((hit) => hit.keyText)).size
        dictionaries.push({
          dictionaryId: i + 1,
          normalUnique: unique,
          nativeFuzzyBranch: unique < limit && Array.from(query).length <= 256
        })
      }
      results.push({
        query,
        limit,
        nodeGlobalNormalCount: globalNormal.length,
        nodeFuzzyBranch: globalNormal.length === 0,
        nativeFuzzyDictionaries: dictionaries.filter((d) => d.nativeFuzzyBranch).length,
        dictionaryCount: paths.length,
        dictionaries
      })
    }
  } finally {
    pair.close()
    for (const index of indexes) index.close()
  }
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        source: path.resolve(resultPath),
        scriptSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'),
        note: 'Branch eligibility inferred from actual exact/loose/prefix results and unchanged candidates() source; not CPU profiling.',
        results
      },
      null,
      2
    )
  )
  console.table(results, [
    'query',
    'limit',
    'nodeGlobalNormalCount',
    'nodeFuzzyBranch',
    'nativeFuzzyDictionaries',
    'dictionaryCount'
  ])
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
