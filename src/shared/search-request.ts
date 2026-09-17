export type SearchRequestSource = 'selection' | 'deep-link' | 'browse'

export type MainWindowSearchRequest = {
  term: string
  source: SearchRequestSource
  dictionaryId?: string
}
