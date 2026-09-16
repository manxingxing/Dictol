export type DictionaryLookupRequest = {
  word: string
  sourceDictionaryId?: string
}

export type DictionaryAggregateRequest = {
  term: string
  dictionaryId?: string
}
