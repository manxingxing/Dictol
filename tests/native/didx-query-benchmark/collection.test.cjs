/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { addon, createPair, stats } = require('./harness.cjs')

test('native collection matches production candidate semantics and lifecycle', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dictol-didx-benchmark-'))
  const paths = []
  const words = [
    'apple',
    'Apple',
    'apple',
    'apply',
    'application',
    'app',
    'hello',
    'help',
    'café',
    'cafe',
    'a-b',
    'ab',
    'a b',
    '中文',
    '中文词典',
    'Ａpple',
    '😀',
    '😀word'
  ]
  try {
    for (let i = 0; i < 12; i++) {
      const filename = path.join(directory, `${i}.didx`)
      await addon.DidxIndex.build(
        [...words, `unique${i}`].map((keyText, ordinal) => ({
          keyText,
          locator: Buffer.from(`${i}:${ordinal}`)
        })),
        BigInt(i + 1),
        filename
      )
      paths.push(filename)
    }
    // More dictionaries than the outer bound; both one and multiple worker threads.
    for (const threads of [1, 4]) {
      const pair = createPair(paths, threads, 3)
      try {
        for (const query of [
          'apple',
          'APPLE',
          'app',
          'a',
          'app*',
          'a??',
          'applf',
          'helo',
          'zzqvxtest',
          'cafe',
          '中文',
          '😀',
          '*apple',
          'app\\*',
          ''
        ]) {
          for (const limit of [0, 1, 5, 50]) {
            assert.deepStrictEqual(
              await pair.rust.candidate(query, limit),
              await pair.node.candidate(query, limit),
              `threads=${threads} query=${query} limit=${limit}`
            )
          }
        }
        // Validate each unmerged stage as well as final merged results.
        for (const [query, stage, baseline] of [
          ['app', 'normal', pair.node.normalCandidates('app', 50)],
          ['app*', 'wildcard', pair.node.queryEach((index) => index.wildcard('app*', 50))],
          ['applf', 'fuzzy', pair.node.queryEach((index) => index.fuzzy('applf', undefined, 50))]
        ]) {
          assert.deepStrictEqual(await pair.native.query(query, stage, 50), await baseline)
        }
        const expected = await pair.node.normalCandidates('app', 50)
        const pending = pair.native.query('app', 'normal', 50)
        pair.native.clear()
        assert.deepStrictEqual(await pending, expected, 'in-flight query retains its snapshot')
        assert.deepStrictEqual(await pair.native.query('app', 'normal', 50), [])
        pair.native.set(1, paths[0])
        pair.native.set(2, paths[1])
        pair.native.set(1, paths[2])
        const replacement = await pair.native.query('unique2', 'normal', 50)
        assert.ok(replacement.some((hit) => hit.dictionaryId === 1 && hit.keyText === 'unique2'))
        assert.equal(pair.native.remove(1), true)
        assert.equal(pair.native.remove(1), false)
        assert.ok(
          (await pair.native.query('app', 'normal', 50)).every((hit) => hit.dictionaryId === 2)
        )
        assert.throws(() => pair.native.set(2, path.join(directory, 'missing.didx')))
        assert.ok(
          (await pair.native.query('app', 'normal', 50)).some((hit) => hit.dictionaryId === 2)
        )
        assert.throws(() => pair.native.set(0, paths[0]), /positive/)
        assert.throws(() => pair.native.query('app', 'invalid', 50), /stage/)
        assert.throws(() => pair.native.query('app', 'normal', 10_001), /limit/)
      } finally {
        pair.close()
      }
    }
    assert.throws(() => new addon.NativeDidxCollection(0, 4), /positive/)
    assert.throws(() => new addon.NativeDidxCollection(8, 0), /positive/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('statistics use nearest-rank percentiles and population standard deviation', () => {
  assert.deepStrictEqual(stats([4, 1, 3, 2]), {
    samples: 4,
    meanMs: 2.5,
    p50Ms: 2,
    p95Ms: 4,
    minMs: 1,
    maxMs: 4,
    stddevMs: Math.sqrt(1.25)
  })
})
