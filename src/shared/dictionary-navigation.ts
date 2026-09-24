export const DICTIONARY_ENTRY_ANCHOR_PARAM = '_dictol_anchor'

export type DictionaryLookupRequest = {
  word: string
  sourceDictionaryId?: string
  anchor?: string
}

export type DictionaryAggregateRequest = {
  term: string
  dictionaryId?: string
  anchor?: string
}
