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

/** Treat # as part of a word only when a source dictionary can confirm it. */
export async function resolveEntryLinkWithAnchor(
  request: DictionaryLookupRequest,
  lookup: DictionaryEntryLookup
): Promise<EntryNavigationResolution> {
  const { word, sourceDictionaryId } = request
  const hashIndex = word.indexOf('#')
  if (hashIndex < 0) {
    return { request, match: null, didLookup: false }
  }

  const fallbackTerm = word.slice(0, hashIndex).trim()
  const fallbackRequest = {
    ...request,
    word: fallbackTerm,
    ...(word.slice(hashIndex + 1) ? { anchor: word.slice(hashIndex + 1) } : {})
  }
  if (!sourceDictionaryId) {
    return { request: fallbackRequest, match: null, didLookup: false }
  }

  try {
    const originalMatch = await lookup(sourceDictionaryId, word)
    if (originalMatch) return { request, match: originalMatch, didLookup: true }

    if (!fallbackTerm) return { request, match: null, didLookup: true }

    return {
      request: fallbackRequest,
      match: { word: fallbackTerm },
      didLookup: true
    }
  } catch (error) {
    console.error('Failed to resolve entry hash fallback', { word, sourceDictionaryId, error })
    return { request, match: null, didLookup: false }
  }
}
