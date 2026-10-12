export type CustomCssEditorTheme = 'light' | 'dark'

export type CustomCssEditorDictionary = {
  dictionaryId: string
  dictionaryName: string
  customCss: string
}

export type CustomCssEditorSearchResult =
  { ok: true; word: string } | { ok: false; message: string; cancelled?: boolean }

export type CustomCssEditorBounds = {
  x: number
  y: number
  width: number
  height: number
}
