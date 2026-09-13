export interface DidxMatch {
  keyText: string
  normalizedKey: string
  locator: Buffer
  keyOrdinal: bigint
  matchKind: string
  distance?: number
}

export interface DidxIndex {
  exact(query: string): Promise<DidxMatch[]>
  loose(query: string, limit?: number): Promise<DidxMatch[]>
  prefix(query: string, limit?: number): Promise<DidxMatch[]>
  fuzzy(query: string, distance?: number, limit?: number): Promise<DidxMatch[]>
  wildcard(pattern: string, limit?: number): Promise<DidxMatch[]>
  candidates(query: string, limit?: number): Promise<DidxMatch[]>
}

export interface EnabledDidxIndex {
  dictionaryId: number
  index: DidxIndex
}

export interface WordFormLookup {
  getBaseForms(word: string): string[]
}

export type DictionaryDidxMatch = DidxMatch & {
  dictionaryId: number
}

export type DidxCandidate = DictionaryDidxMatch & {
  dictionaryIds: number[]
}

export type RelatedFormMatches = {
  form: string
  matches: DictionaryDidxMatch[]
}

export type DidxLookupResult = {
  query: string
  exact: DictionaryDidxMatch[]
  relatedForms: RelatedFormMatches[]
  loose: DictionaryDidxMatch[]
  suggestions: DidxCandidate[]
  wildcard: DidxCandidate[]
}

const DEFAULT_LIMIT = 50
const DEFAULT_QUERY_CONCURRENCY = 8

export class DidxQueryService {
  constructor(
    private readonly dictionaries: readonly EnabledDidxIndex[],
    private readonly wordForms: WordFormLookup,
    private readonly queryConcurrency = DEFAULT_QUERY_CONCURRENCY
  ) {
    if (!Number.isSafeInteger(queryConcurrency) || queryConcurrency < 1) {
      throw new Error('查询并发数必须是大于 0 的整数')
    }
  }

  async exact(query: string): Promise<DictionaryDidxMatch[]> {
    return this.queryEach((index) => index.exact(query))
  }

  async candidate(query: string, limit = DEFAULT_LIMIT): Promise<DidxCandidate[]> {
    limit = boundedLimit(limit)
    const wildcard = isSupportedWildcardPattern(query)
    const matches = wildcard
      ? await this.queryEach((index) => index.wildcard(query, limit))
      : await this.normalCandidates(query, limit)
    let candidates = this.mergeCandidates(matches, limit, query)
    if (!wildcard && candidates.length === 0) {
      const fuzzy = await this.queryEach((index) => index.fuzzy(query, undefined, limit))
      candidates = this.mergeFuzzyCandidates(fuzzy, limit, query)
    }
    return candidates
  }

  private mergeCandidates(
    matches: DictionaryDidxMatch[],
    limit: number,
    query: string
  ): DidxCandidate[] {
    const grouped = new Map<string, DidxCandidate>()
    for (const match of sortCandidates(matches, query)) {
      if (match.matchKind === 'fuzzy' && sharedPrefixLength(query, match.keyText) === 0) {
        continue
      }
      const candidateKey = match.keyText.toLowerCase()
      const existing = grouped.get(candidateKey)
      if (existing) {
        if (!existing.dictionaryIds.includes(match.dictionaryId)) {
          existing.dictionaryIds.push(match.dictionaryId)
        }
      } else {
        grouped.set(candidateKey, { ...match, dictionaryIds: [match.dictionaryId] })
      }
    }
    return [...grouped.values()].slice(0, limit)
  }

  private mergeFuzzyCandidates(
    matches: DictionaryDidxMatch[],
    limit: number,
    query: string
  ): DidxCandidate[] {
    let bestDistance: number | undefined
    for (const match of matches) {
      if (
        match.matchKind === 'fuzzy' &&
        match.distance !== undefined &&
        (bestDistance === undefined || match.distance < bestDistance)
      ) {
        bestDistance = match.distance
      }
    }
    if (bestDistance === undefined) return []
    return this.mergeCandidates(
      matches.filter((match) => match.matchKind === 'fuzzy' && match.distance === bestDistance),
      limit,
      query
    )
  }

  async lookup(query: string, limit = DEFAULT_LIMIT): Promise<DidxLookupResult> {
    limit = boundedLimit(limit)
    if (isSupportedWildcardPattern(query)) {
      const wildcard = await this.candidate(query, limit)
      return { query, exact: [], relatedForms: [], loose: [], suggestions: [], wildcard }
    }

    const exactPromise = this.queryEach((index) => index.exact(query))
    const loosePromise = this.queryEach((index) => index.loose(query, limit), limit)
    const relatedFormsPromise = Promise.all(
      this.wordForms
        .getBaseForms(query)
        .filter((form) => form.trim().toLowerCase() !== query.trim().toLowerCase())
        .map(async (form) => ({
          form,
          matches: await this.queryEach((index) => index.exact(form))
        }))
    )

    const [exact, loose, relatedForms] = await Promise.all([
      exactPromise,
      loosePromise,
      relatedFormsPromise
    ])
    let suggestions: DidxCandidate[] = []
    if (exact.length === 0) {
      const prefix = await this.queryEach((index) => index.prefix(query, limit))
      suggestions = this.mergeCandidates(prefix, limit, query)
      if (suggestions.length === 0) {
        const fuzzy = await this.queryEach((index) => index.fuzzy(query, undefined, limit))
        suggestions = this.mergeFuzzyCandidates(fuzzy, limit, query)
      }
    }

    return {
      query,
      exact,
      relatedForms: relatedForms.filter(({ matches }) => matches.length > 0),
      loose,
      suggestions,
      wildcard: []
    }
  }

  private async normalCandidates(query: string, limit: number): Promise<DictionaryDidxMatch[]> {
    return this.queryEach(async (index) => {
      const [exact, loose, prefix] = await Promise.all([
        index.exact(query).then((matches) => matches.slice(0, limit)),
        index.loose(query, limit),
        index.prefix(query, limit)
      ])
      return [...exact, ...loose, ...prefix]
    })
  }

  private async queryEach(
    query: (index: DidxIndex) => Promise<DidxMatch[]>,
    limit?: number
  ): Promise<DictionaryDidxMatch[]> {
    const groups = await mapWithConcurrency(
      this.dictionaries,
      this.queryConcurrency,
      async ({ dictionaryId, index }) =>
        (await query(index)).map((match) => ({ ...match, dictionaryId }))
    )
    const matches = groups.flat()
    return limit === undefined ? matches : matches.slice(0, limit)
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++
      if (index >= values.length) return
      results[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return results
}

function isSupportedWildcardPattern(query: string): boolean {
  if (!query.includes('*') && !query.includes('?')) return false
  const term = query.trimStart()
  return !term.startsWith('*') && !term.startsWith('?')
}

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) throw new RangeError('DIDX limit must be finite')
  return Math.max(0, Math.min(10_000, Math.floor(limit)))
}

function sortCandidates(matches: DictionaryDidxMatch[], query: string): DictionaryDidxMatch[] {
  const dictionaryOrder = new Map(
    matches.map(({ dictionaryId }) => dictionaryId).map((id, index) => [id, index])
  )
  return matches.sort((left, right) => {
    const rankDifference = candidateRank(left) - candidateRank(right)
    if (rankDifference !== 0) return rankDifference

    if (left.matchKind === 'prefix') {
      const lengthDifference = Array.from(left.keyText).length - Array.from(right.keyText).length
      if (lengthDifference !== 0) return lengthDifference
    }

    if (left.matchKind === 'fuzzy' && right.matchKind === 'fuzzy') {
      const distanceDifference = (left.distance ?? 0) - (right.distance ?? 0)
      if (distanceDifference !== 0) return distanceDifference

      const sharedPrefixDifference =
        sharedPrefixLength(query, right.keyText) - sharedPrefixLength(query, left.keyText)
      if (sharedPrefixDifference !== 0) return sharedPrefixDifference

      const queryLength = fuzzyComparisonKey(query).length
      const lengthDifference =
        Math.abs(fuzzyComparisonKey(left.keyText).length - queryLength) -
        Math.abs(fuzzyComparisonKey(right.keyText).length - queryLength)
      if (lengthDifference !== 0) return lengthDifference
    } else {
      const distanceDifference = (left.distance ?? 0) - (right.distance ?? 0)
      if (distanceDifference !== 0) return distanceDifference
    }

    const normalizedDifference = compareKeys(left.normalizedKey, right.normalizedKey)
    if (normalizedDifference !== 0) return normalizedDifference

    const displayDifference = compareKeys(left.keyText, right.keyText)
    if (displayDifference !== 0) return displayDifference

    const dictionaryDifference =
      (dictionaryOrder.get(left.dictionaryId) ?? 0) - (dictionaryOrder.get(right.dictionaryId) ?? 0)
    if (dictionaryDifference !== 0) return dictionaryDifference

    return left.keyOrdinal < right.keyOrdinal ? -1 : left.keyOrdinal > right.keyOrdinal ? 1 : 0
  })
}

// Match Rust's UTF-8 ordering so per-dictionary Top-K remains valid after merging.
function compareKeys(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function fuzzyComparisonKey(value: string): string {
  return value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}

function sharedPrefixLength(left: string, right: string): number {
  const leftChars = Array.from(fuzzyComparisonKey(left))
  const rightChars = Array.from(fuzzyComparisonKey(right))
  let length = 0
  while (length < leftChars.length && leftChars[length] === rightChars[length]) length += 1
  return length
}

function candidateRank(match: DidxMatch): number {
  if (match.matchKind === 'exact') return 0
  if (match.matchKind === 'case-insensitive') return 1
  if (match.matchKind === 'loose') return 2
  if (match.matchKind === 'prefix') return 3
  if (match.matchKind === 'fuzzy') return 4
  return 5
}
