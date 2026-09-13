export type SearchPopoverItem = {
  word: string
  description: string
  recent: boolean
}

export type SearchPopoverScope = {
  id: string | null
  name: string
  dictionaryCount: number | null
}

export type SearchPopoverPayload = {
  query: string
  items: SearchPopoverItem[]
  selectedIndex: number
  status?: 'loading' | 'empty' | 'error'
  error?: string
  scopes: SearchPopoverScope[]
  scopeId: string | null
}

export const SEARCH_POPOVER_SUGGESTION_LIMIT = 30
export const SEARCH_POPOVER_MAX_VISIBLE_ROWS = 10
export const SEARCH_POPOVER_ROW_HEIGHT = 42
export const SEARCH_POPOVER_SUGGESTION_LIST_MAX_HEIGHT =
  SEARCH_POPOVER_MAX_VISIBLE_ROWS * SEARCH_POPOVER_ROW_HEIGHT
