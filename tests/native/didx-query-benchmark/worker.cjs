/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { performance } = require('node:perf_hooks')
const { createPair, stats } = require('./harness.cjs')

async function main() {
  const config = JSON.parse(process.argv[2])
  const results = []
  for (const count of config.counts) {
    const pair = createPair(config.paths.slice(0, count), config.threads)
    try {
      const cases = config.queries.map((query) => ({
        query,
        count,
        node: [],
        rust: [],
        rounds: [],
        candidateCount: 0
      }))
      // Equality checks and warmup are outside timed regions. Every query is checked
      // again after each timed batch, including locators, order and dictionary IDs.
      for (const entry of cases) {
        for (let warmup = 0; warmup < config.warmup; warmup++) {
          const expected = await pair.node.candidate(entry.query, config.limit)
          const actual = await pair.rust.candidate(entry.query, config.limit)
          assert.deepStrictEqual(actual, expected, `warmup: ${entry.query}`)
          entry.candidateCount = expected.length
        }
      }
      for (let round = 0; round < config.rounds; round++) {
        // Rotate and reverse query order to distribute drift over the workload.
        const order = cases.map((_, i) => cases[(i + round) % cases.length])
        if (round % 2) order.reverse()
        for (const entry of order) {
          const samples = { node: [], rust: [] }
          for (let repetition = 0; repetition < config.repetitions; repetition++) {
            const variants = (round + repetition) % 2 ? ['rust', 'node'] : ['node', 'rust']
            const output = {}
            for (const variant of variants) {
              const start = performance.now()
              output[variant] = await pair[variant].candidate(entry.query, config.limit)
              samples[variant].push(performance.now() - start)
            }
            assert.deepStrictEqual(output.rust, output.node, `timed: ${entry.query}`)
          }
          entry.node.push(...samples.node)
          entry.rust.push(...samples.rust)
          entry.rounds.push({
            round: round + 1,
            node: stats(samples.node),
            rust: stats(samples.rust)
          })
        }
        console.log(
          `UV=${process.env.UV_THREADPOOL_SIZE}, Rust=${config.threads}, indexes=${count}, round ${round + 1}/${config.rounds}`
        )
      }
      for (const entry of cases) {
        results.push({
          ...entry,
          nodeStats: stats(entry.node),
          rustStats: stats(entry.rust),
          speedup: stats(entry.node).meanMs / stats(entry.rust).meanMs
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
        rustThreads: config.threads,
        results
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
