/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { performance } = require('node:perf_hooks')
const { stats } = require('./harness.cjs')
const { createCandidatesPair, compareResults } = require('./candidates-harness.cjs')

async function main() {
  const config = JSON.parse(process.argv[2])
  const results = []
  for (const count of config.counts) {
    const pair = createCandidatesPair(config.paths.slice(0, count))
    try {
      const cases = config.limits.flatMap((limit) =>
        config.queries.map((query) => ({
          query,
          limit,
          count,
          baseline: [],
          combined: [],
          rounds: [],
          outputs: {},
          comparison: null,
          comparedPairs: 0
        }))
      )
      const check = (entry, outputs) => {
        if (!entry.comparison) {
          entry.outputs = outputs
          entry.comparison = compareResults(outputs.baseline, outputs.combined)
        } else {
          for (const variant of ['baseline', 'combined']) {
            assert.deepStrictEqual(
              outputs[variant],
              entry.outputs[variant],
              `${variant} result changed across repetitions: ${entry.query}`
            )
          }
        }
        // Differences between algorithms are data, not failures. Each variant must
        // remain deterministic, and the comparison is outside the timed region.
        const comparison = compareResults(outputs.baseline, outputs.combined)
        assert.equal(comparison.fullEqual, entry.comparison.fullEqual)
        assert.equal(comparison.displayEqual, entry.comparison.displayEqual)
        entry.comparedPairs++
      }
      for (const entry of cases) {
        for (let i = 0; i < config.warmup; i++) {
          check(entry, {
            baseline: await pair.baseline.candidate(entry.query, entry.limit),
            combined: await pair.combined.candidate(entry.query, entry.limit)
          })
        }
      }
      for (let round = 0; round < config.rounds; round++) {
        const order = cases.map((_, i) => cases[(i + round) % cases.length])
        if (round % 2) order.reverse()
        for (const entry of order) {
          const samples = { baseline: [], combined: [] }
          for (let repetition = 0; repetition < config.repetitions; repetition++) {
            const variants =
              (round + repetition) % 2 ? ['combined', 'baseline'] : ['baseline', 'combined']
            const outputs = {}
            for (const variant of variants) {
              const start = performance.now()
              outputs[variant] = await pair[variant].candidate(entry.query, entry.limit)
              samples[variant].push(performance.now() - start)
            }
            check(entry, outputs)
          }
          entry.baseline.push(...samples.baseline)
          entry.combined.push(...samples.combined)
          entry.rounds.push({
            round: round + 1,
            baseline: stats(samples.baseline),
            combined: stats(samples.combined)
          })
        }
        console.log(
          `candidates: UV=${process.env.UV_THREADPOOL_SIZE}, indexes=${count}, round ${round + 1}/${config.rounds}`
        )
      }
      for (const entry of cases) {
        results.push({
          ...entry,
          baselineStats: stats(entry.baseline),
          combinedStats: stats(entry.combined),
          speedup: stats(entry.baseline).meanMs / stats(entry.combined).meanMs
        })
      }
    } finally {
      pair.close()
    }
  }
  writeFileSync(
    config.resultPath,
    JSON.stringify(
      {
        uvThreads: Number(process.env.UV_THREADPOOL_SIZE),
        results
      },
      (_, item) => (typeof item === 'bigint' ? item.toString() : item),
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
