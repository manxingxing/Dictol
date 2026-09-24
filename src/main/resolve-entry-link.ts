import type { DictionaryLookupRequest } from '../shared/dictionary-navigation'

type DictionaryEntryLookup = (
  dictionaryId: string,
  term: string
) => Promise<{ word: string } | null>

export type EntryNavigationResolution = {
  request: DictionaryLookupRequest
  match: { word: string } | null
  didLookup: boolean
}

/** Resolve entry://word#anchor against its source dictionary before routing. */
export async function resolveEntryLinkWithAnchor(
  request: DictionaryLookupRequest,
  lookup: DictionaryEntryLookup
): Promise<EntryNavigationResolution> {
  const { word, sourceDictionaryId } = request
  const hashIndex = word.indexOf('#')
  if (!sourceDictionaryId || hashIndex < 0) {
    return { request, match: null, didLookup: false }
  }

  try {
    const originalMatch = await lookup(sourceDictionaryId, word)
    if (originalMatch) return { request, match: originalMatch, didLookup: true }

    const fallbackTerm = word.slice(0, hashIndex).trim()
    if (!fallbackTerm) return { request, match: null, didLookup: true }

    const match = await lookup(sourceDictionaryId, fallbackTerm)
    if (!match) return { request, match: null, didLookup: true }

    return {
      request: {
        ...request,
        word: match.word,
        ...(word.slice(hashIndex + 1) ? { anchor: word.slice(hashIndex + 1) } : {})
      },
      match,
      didLookup: true
    }
  } catch (error) {
    console.error('Failed to resolve entry hash fallback', { word, sourceDictionaryId, error })
    return { request, match: null, didLookup: false }
  }
}
