/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { readFileSync } = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../../..')
const filename = path.join(root, 'src/main/didx-query-service.ts')
const source = readFileSync(filename, 'utf8')
// Reuse the real service and its private merge helpers. This only changes the
// in-memory benchmark module; it does not modify or bundle production source.
const compiled = ts.transpileModule(
  `${source}\nexport { boundedLimit, isSupportedWildcardPattern }`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText
const loaded = new Module(filename, module)
loaded._compile(compiled, filename)
const { DidxQueryService, boundedLimit, isSupportedWildcardPattern } = loaded.exports
const addon = require('./benchmark.node')

function createPair(paths, threads, concurrency = 8) {
  const dictionaries = paths.map((indexPath, position) => ({
    dictionaryId: position + 1,
    index: addon.DidxIndex.open(indexPath)
  }))
  const native = new addon.NativeDidxCollection(concurrency, threads)
  paths.forEach((indexPath, position) => native.set(position + 1, indexPath))
  const node = new DidxQueryService(dictionaries, { getBaseForms: () => [] }, concurrency)
  const rust = {
    async candidate(query, limit = 50) {
      limit = boundedLimit(limit)
      const wildcard = isSupportedWildcardPattern(query)
      const matches = await native.query(query, wildcard ? 'wildcard' : 'normal', limit)
      let candidates = node.mergeCandidates(matches, limit, query)
      if (!wildcard && candidates.length === 0) {
        candidates = node.mergeFuzzyCandidates(
          await native.query(query, 'fuzzy', limit),
          limit,
          query
        )
      }
      return candidates
    }
  }
  return {
    node,
    rust,
    native,
    dictionaries,
    close() {
      native.clear()
      for (const { index } of dictionaries) {
        if (!index.close()) throw new Error('Unexpected pending DIDX task during cleanup')
      }
    }
  }
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
  return {
    samples: values.length,
    meanMs: mean,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    stddevMs: Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / values.length)
  }
}

module.exports = { addon, createPair, stats, source, root, DidxQueryService, boundedLimit }
