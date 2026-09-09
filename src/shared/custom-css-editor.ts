export type CustomCssEditorTheme = 'light' | 'dark'

export type CustomCssEditorState = {
  dictionaryId: string
  dictionaryName: string
  customCss: string
  recordCount: number | null
  entryId: string
  entryWord: string
}

export type CustomCssEditorSearchResult =
  { ok: true; state: CustomCssEditorState } | { ok: false; message: string }

export type CustomCssEditorBounds = {
  x: number
  y: number
  width: number
  height: number
}
