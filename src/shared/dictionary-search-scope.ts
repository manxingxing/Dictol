export type DictionarySearchScopeSource = 'search-panel' | 'search-popover'

export type DictionarySearchScopeChange = {
  groupId: string | null
  source: DictionarySearchScopeSource
}
