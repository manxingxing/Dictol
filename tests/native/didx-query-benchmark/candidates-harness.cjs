/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { isDeepStrictEqual } = require('node:util')
const { addon, DidxQueryService, boundedLimit } = require('./harness.cjs')

function createCandidatesPair(paths, concurrency = 8) {
  const open = () =>
    paths.map((filename, i) => ({
      dictionaryId: i + 1,
      index: addon.DidxIndex.open(filename)
    }))
  const baselineIndexes = open()
  const combinedIndexes = open()
  const baseline = new DidxQueryService(baselineIndexes, { getBaseForms: () => [] }, concurrency)
  const merger = new DidxQueryService(combinedIndexes, { getBaseForms: () => [] }, concurrency)
  return {
    baseline,
    combined: {
      async candidate(query, limit = 50) {
        limit = boundedLimit(limit)
        // Call the existing Rust API without altering its fuzzy or wildcard behavior.
        // Reuse production bounded scheduling and global merge for a multi-index result.
        const matches = await merger.queryEach((index) => index.candidates(query, limit))
        return merger.mergeCandidates(matches, limit, query)
      }
    },
    close() {
      for (const { index } of [...baselineIndexes, ...combinedIndexes]) {
        if (!index.close()) throw new Error('Pending DIDX query during cleanup')
      }
    }
  }
}

function displayResult(matches) {
  // Exactly the payload produced by DbService.searchDictionaryEntries.
  return matches.map((match) => ({
    word: match.keyText,
    normalizedWord: match.normalizedKey,
    dictionaryIds: match.dictionaryIds.map(String)
  }))
}

function compareResults(baseline, combined) {
  const before = displayResult(baseline)
  const after = displayResult(combined)
  const beforeWords = before.map((hit) => hit.word)
  const afterWords = after.map((hit) => hit.word)
  const beforeSet = new Set(beforeWords)
  const afterSet = new Set(afterWords)
  const beforeByWord = new Map(baseline.map((hit) => [hit.keyText, hit]))
  return {
    fullEqual: isDeepStrictEqual(baseline, combined),
    displayEqual: isDeepStrictEqual(before, after),
    wordsEqual: isDeepStrictEqual(beforeWords, afterWords),
    removed: beforeWords.filter((word) => !afterSet.has(word)),
    added: afterWords.filter((word) => !beforeSet.has(word)),
    changed: combined.flatMap((hit, position) => {
      const previous = beforeByWord.get(hit.keyText)
      if (!previous || isDeepStrictEqual(previous, hit)) return []
      return [
        {
          word: hit.keyText,
          baselinePosition: beforeWords.indexOf(hit.keyText),
          combinedPosition: position,
          baseline: previous,
          combined: hit
        }
      ]
    }),
    baselineCount: baseline.length,
    combinedCount: combined.length
  }
}

module.exports = { createCandidatesPair, compareResults, displayResult }
