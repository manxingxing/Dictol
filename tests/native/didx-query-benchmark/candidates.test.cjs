/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { addon } = require('./harness.cjs')
const { createCandidatesPair, compareResults } = require('./candidates-harness.cjs')

test('candidate comparison exposes native fuzzy completion and wildcard differences', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dictol-candidates-'))
  let pair
  try {
    const paths = []
    for (const [i, words] of [
      ['apple', 'apple', 'apply', 'hello', '中文', '😀'],
      ['applet', 'applet', '中文词典', '😀word'],
      ['apply']
    ].entries()) {
      const filename = path.join(directory, `${i}.didx`)
      await addon.DidxIndex.build(
        words.map((keyText, ordinal) => ({
          keyText,
          locator: Buffer.from(`${i}:${ordinal}`)
        })),
        BigInt(i + 1),
        filename
      )
      paths.push(filename)
    }
    pair = createCandidatesPair(paths)
    const before = await pair.baseline.candidate('apple', 50)
    const after = await pair.combined.candidate('apple', 50)
    assert.deepStrictEqual(
      before.map((hit) => hit.keyText),
      ['apple', 'applet']
    )
    assert.ok(after.some((hit) => hit.keyText === 'apply' && hit.matchKind === 'fuzzy'))
    const difference = compareResults(before, after)
    assert.equal(difference.fullEqual, false)
    assert.equal(difference.displayEqual, false)
    assert.ok(difference.added.includes('apply'))

    // Node chooses the globally nearest fuzzy tier; native completion retains
    // independently selected distances from each dictionary.
    const fuzzyBefore = await pair.baseline.candidate('applf', 50)
    const fuzzyAfter = await pair.combined.candidate('applf', 50)
    assert.ok(fuzzyBefore.every((hit) => hit.distance === 1))
    assert.ok(fuzzyAfter.some((hit) => hit.keyText === 'applet' && hit.distance === 2))

    const wildcardBefore = await pair.baseline.candidate('app*', 50)
    const wildcardAfter = await pair.combined.candidate('app*', 50)
    assert.ok(
      wildcardBefore.length > 0 && wildcardBefore.every((hit) => hit.matchKind === 'wildcard')
    )
    assert.ok(wildcardAfter.every((hit) => hit.matchKind !== 'wildcard'))
    assert.equal(compareResults(wildcardBefore, wildcardAfter).fullEqual, false)

    for (const query of ['apple', '中文', '😀', 'zzqvxtest']) {
      assert.deepStrictEqual(
        await pair.combined.candidate(query, 0),
        await pair.baseline.candidate(query, 0)
      )
    }
    assert.deepStrictEqual(
      await pair.combined.candidate('apple', 1),
      await pair.baseline.candidate('apple', 1)
    )
    assert.deepStrictEqual(await pair.combined.candidate('zzqvxtest', 50), [])
  } finally {
    pair?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('display comparison distinguishes source metadata from visible changes', () => {
  const hit = {
    keyText: 'apple',
    normalizedKey: 'apple',
    locator: Buffer.from('first'),
    keyOrdinal: 0n,
    matchKind: 'exact',
    dictionaryId: 1,
    dictionaryIds: [1]
  }
  const comparison = compareResults([hit], [{ ...hit, locator: Buffer.from('second') }])
  assert.equal(comparison.fullEqual, false)
  assert.equal(comparison.displayEqual, true)
  assert.equal(comparison.wordsEqual, true)
  assert.equal(comparison.changed.length, 1)
  assert.deepStrictEqual(comparison.added, [])
  assert.deepStrictEqual(comparison.removed, [])
})
