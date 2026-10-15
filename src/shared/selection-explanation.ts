export const SELECTION_EXPLANATION_HEADER_HEIGHT = 40
export const SELECTION_EXPLANATION_DICTIONARY_TAB_BAR_HEIGHT = 42
export const SELECTION_EXPLANATION_DICTIONARY_SWITCHER_HEIGHT =
  SELECTION_EXPLANATION_DICTIONARY_TAB_BAR_HEIGHT + 1

export type SelectionExplanationDictionary = {
  dictionaryId: string
  dictionaryName: string
  dictionaryIconUrl: string | null
}

export type SelectionExplanationPayload = {
  mode: 'dictionary' | 'ai'
  requestId: number
  word: string
  aiEnabled?: boolean
  pinned?: boolean
  dictionaryName?: string
  dictionaries?: SelectionExplanationDictionary[]
  activeDictionaryId?: string
  state: 'loading' | 'refreshing' | 'empty' | 'content' | 'error'
  content?: string
  complete?: boolean
  message?: string
}
