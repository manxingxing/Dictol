export type TouchBarPage = 'search' | null

export type TouchBarDictionary = {
  dictionaryId: string
  dictionaryName: string
}

export type TouchBarState = {
  word: string | null
  starred: boolean
  dictionaries: TouchBarDictionary[]
}
