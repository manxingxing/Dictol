import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useDebounce from 'react-use/lib/useDebounce'

import { useDictionarySearch, useDictionarySearchGroups } from '@/hooks/use-dictionary-entries'
import { useReadyDictionaries } from '@/hooks/use-dictionaries'
import { useDictionarySearchScope } from '@/hooks/use-dictionary-search-scope'
import { useQueryHistory } from '@/hooks/use-query-history'
import { useSearchShortCut } from '@/hooks/use-search-shortcut'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import {
  SEARCH_POPOVER_MAX_VISIBLE_ROWS,
  SEARCH_POPOVER_ROW_HEIGHT,
  SEARCH_POPOVER_SUGGESTION_LIMIT
} from '../../../shared/search-popover'
import { MAIN_WINDOW_TITLEBAR_CONTROL_HEIGHT } from '../../../shared/window-chrome'
import { DICTIONARY_SEARCH_ERROR_MESSAGE } from '../../../shared/dictionary-search-error'

type Suggestion = {
  word: string
  description: string
  recent: boolean
}

const POPOVER_HORIZONTAL_GUTTER = 12
const POPOVER_BOTTOM_GUTTER = 8
const POPOVER_OFFSET = 3
const POPOVER_SURFACE_HEIGHT = 10
const POPOVER_SCOPE_HEIGHT = 38
const POPOVER_SCOPE_MENU_ROW_HEIGHT = 36
const POPOVER_SCOPE_MENU_SURFACE_HEIGHT = 14

export const CompactTitleBarSearch = (): React.JSX.Element => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const query = useAppStore((state) => state.searchQuery)
  const setQuery = useAppStore((state) => state.setSearchQuery)
  const anchorRef = useRef<HTMLDivElement>(null)
  const popoverOpenRef = useRef(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popoverVisible, setPopoverVisible] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const [delayedLoadingQuery, setDelayedLoadingQuery] = useState<string | null>(null)
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const searchShortcutLabel = window.dictol.platform === 'darwin' ? '⌘ K' : 'Ctrl K'
  const { data: readyDictionaries, isLoading: areDictionariesLoading } = useReadyDictionaries()
  const searchDisabled =
    areDictionariesLoading ||
    !readyDictionaries?.length ||
    readyDictionaries.some(({ indexStatus }) => indexStatus !== 'ready')

  useDebounce(() => setDebouncedQuery(query.trim()), 120, [query])

  const { data: history = [] } = useQueryHistory()
  const { data: groups } = useDictionarySearchGroups()
  const scopes = useMemo(
    () => [
      { id: null, name: '全部', dictionaryCount: null },
      ...(groups ?? []).map((group) => ({ ...group, dictionaryCount: group.dictionaryCount }))
    ],
    [groups]
  )
  const { scopeId: activeScopeId, selectedScope } = useDictionarySearchScope(scopes)
  const {
    data: results = [],
    isFetching,
    isError: isSearchError
  } = useDictionarySearch(
    searchDisabled ? '' : debouncedQuery,
    SEARCH_POPOVER_SUGGESTION_LIMIT,
    activeScopeId
  )

  const normalizedQuery = query.trim()
  const searchPending =
    normalizedQuery.length > 0 &&
    (debouncedQuery.toLowerCase() !== normalizedQuery.toLowerCase() || isFetching)

  useDebounce(() => setDelayedLoadingQuery(searchPending ? normalizedQuery : null), 200, [
    normalizedQuery,
    searchPending
  ])

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!query) {
      return history.slice(0, SEARCH_POPOVER_SUGGESTION_LIMIT).map((item) => ({
        word: item.term,
        description: '最近查询',
        recent: true
      }))
    }
    if (isSearchError) return []
    return results.slice(0, SEARCH_POPOVER_SUGGESTION_LIMIT).map((result) => ({
      word: result.word,
      description: '词典',
      recent: false
    }))
  }, [history, isSearchError, query, results])

  const showDelayedLoading =
    searchPending && suggestions.length === 0 && delayedLoadingQuery === normalizedQuery
  const popoverStatus: 'loading' | 'empty' | 'error' | undefined = normalizedQuery
    ? isSearchError
      ? 'error'
      : showDelayedLoading
        ? 'loading'
        : !searchPending && suggestions.length === 0
          ? 'empty'
          : undefined
    : undefined

  const hidePopover = useCallback((): void => {
    popoverOpenRef.current = false
    setPopoverOpen(false)
    window.dictol.searchPopover.hide()
  }, [])

  const showPopover = useCallback((): boolean => {
    if (searchDisabled) return false
    popoverOpenRef.current = true
    setPopoverVisible(false)
    setPopoverOpen(true)
    return true
  }, [searchDisabled])

  useSearchShortCut(showPopover)

  const openWord = useCallback(
    (word: string): void => {
      const normalizedWord = word.trim()
      if (!normalizedWord) return
      setQuery(normalizedWord)
      hidePopover()

      const params = new URLSearchParams()
      const dictionaryId = searchParams.get('dictionaryId')
      if (dictionaryId) params.set('dictionaryId', dictionaryId)
      const query = params.size ? `?${params}` : ''

      void navigate(`/search/${encodeURIComponent(normalizedWord)}${query}`)
    },
    [hidePopover, navigate, searchParams, setQuery]
  )

  const openFirstResult = useCallback(
    async (submittedQuery: string): Promise<void> => {
      const normalizedSubmittedQuery = submittedQuery.trim()
      if (!normalizedSubmittedQuery) {
        const firstHistoryItem = suggestions[0]
        if (firstHistoryItem) openWord(firstHistoryItem.word)
        return
      }

      const currentSuggestion = suggestions[0]
      if (
        currentSuggestion &&
        !isFetching &&
        normalizedSubmittedQuery.toLowerCase() === normalizedQuery.toLowerCase()
      ) {
        openWord(currentSuggestion.word)
        return
      }

      const first = await window.dictol.entries
        .search(normalizedSubmittedQuery, 1, activeScopeId)
        .then((items) => items[0])
      if (first) openWord(first.word)
    },
    [activeScopeId, isFetching, normalizedQuery, openWord, suggestions]
  )

  useEffect(() => window.dictol.searchPopover.onSelect(openWord), [openWord])
  useEffect(
    () => window.dictol.searchPopover.onQueryChange((nextQuery) => setQuery(nextQuery)),
    [setQuery]
  )
  useEffect(
    () =>
      window.dictol.searchPopover.onSubmit((submittedQuery) => {
        void openFirstResult(submittedQuery).catch((error: unknown) => {
          console.error('Failed to open the first compact search result', error)
        })
      }),
    [openFirstResult]
  )
  useEffect(() => window.dictol.searchPopover.onScopeMenuOpen(setScopeMenuOpen), [])
  useEffect(
    () =>
      window.dictol.searchPopover.onDismiss(() => {
        popoverOpenRef.current = false
        setPopoverVisible(false)
        setPopoverOpen(false)
      }),
    []
  )
  useEffect(
    () =>
      window.dictol.searchPopover.onShown(() => {
        if (popoverOpenRef.current) setPopoverVisible(true)
      }),
    []
  )
  useEffect(
    () =>
      window.dictol.searchPopover.onHidden(() => {
        if (!popoverOpenRef.current) setPopoverVisible(false)
      }),
    []
  )

  const syncPopover = useCallback((): void => {
    const anchor = anchorRef.current
    if (!anchor || !popoverOpenRef.current) return

    const bounds = anchor.getBoundingClientRect()
    const hasSuggestions = suggestions.length > 0 || popoverStatus !== undefined
    const suggestionSurfaceHeight = hasSuggestions
      ? POPOVER_OFFSET +
        POPOVER_SCOPE_HEIGHT +
        Math.min(Math.max(1, suggestions.length), SEARCH_POPOVER_MAX_VISIBLE_ROWS) *
          SEARCH_POPOVER_ROW_HEIGHT +
        POPOVER_SURFACE_HEIGHT
      : POPOVER_OFFSET + POPOVER_SCOPE_HEIGHT + POPOVER_SURFACE_HEIGHT
    const scopeMenuHeight = scopeMenuOpen
      ? POPOVER_OFFSET +
        POPOVER_SCOPE_HEIGHT +
        scopes.length * POPOVER_SCOPE_MENU_ROW_HEIGHT +
        POPOVER_SCOPE_MENU_SURFACE_HEIGHT
      : 0
    const popoverY = Math.max(0, bounds.y)
    const desiredHeight =
      MAIN_WINDOW_TITLEBAR_CONTROL_HEIGHT +
      Math.max(suggestionSurfaceHeight, scopeMenuHeight) +
      POPOVER_BOTTOM_GUTTER

    window.dictol.searchPopover.show()
    window.dictol.searchPopover.setBounds({
      x: Math.max(0, bounds.x - POPOVER_HORIZONTAL_GUTTER),
      y: popoverY,
      width: bounds.width + POPOVER_HORIZONTAL_GUTTER * 2,
      height: Math.min(desiredHeight, Math.max(0, window.innerHeight - popoverY))
    })
    window.dictol.searchPopover.update(
      query,
      suggestions,
      suggestions.length > 0 ? 0 : -1,
      popoverStatus,
      isSearchError ? DICTIONARY_SEARCH_ERROR_MESSAGE : undefined,
      scopes,
      activeScopeId
    )
  }, [activeScopeId, isSearchError, popoverStatus, query, scopeMenuOpen, scopes, suggestions])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const observer = new ResizeObserver(syncPopover)
    observer.observe(anchor)
    window.addEventListener('resize', syncPopover)
    syncPopover()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncPopover)
    }
  }, [popoverOpen, syncPopover])

  useEffect(() => {
    if (!popoverOpen) return

    const handlePointerDown = (event: PointerEvent): void => {
      if (anchorRef.current?.contains(event.target as Node)) return
      hidePopover()
    }
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
  }, [hidePopover, popoverOpen])

  useEffect(() => () => window.dictol.searchPopover.hide(), [])
  useEffect(() => {
    if (searchDisabled && popoverOpenRef.current) hidePopover()
  }, [hidePopover, searchDisabled])

  return (
    <div
      ref={anchorRef}
      className="no-drag min-w-0 flex-1 sm:max-w-[360px]"
      style={{ height: MAIN_WINDOW_TITLEBAR_CONTROL_HEIGHT }}
    >
      <button
        aria-expanded={popoverOpen}
        aria-haspopup="listbox"
        aria-label="搜索单词"
        aria-keyshortcuts={window.dictol.platform === 'darwin' ? 'Meta+K' : 'Control+K'}
        className={cn(
          'titlebar-search-trigger relative flex h-full w-full cursor-text items-center rounded-lg border px-3 text-left text-sm shadow-none outline-none',
          popoverOpen && popoverVisible && 'invisible'
        )}
        onClick={showPopover}
        disabled={searchDisabled}
        type="button"
      >
        <span className="max-w-20 truncate text-xs text-muted-foreground">
          {selectedScope.name}
        </span>
        <span aria-hidden="true" className="mx-2 h-4 w-px bg-border" />
        <span
          className={
            query
              ? 'pointer-events-none absolute left-1/2 flex max-w-[52%] -translate-x-1/2 items-center gap-2 truncate text-foreground'
              : 'pointer-events-none absolute left-1/2 flex max-w-[52%] -translate-x-1/2 items-center gap-2 truncate text-muted-foreground'
          }
        >
          {searchPending ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{query || '搜索'}</span>
        </span>
        <kbd className="titlebar-search-shortcut">{searchShortcutLabel}</kbd>
      </button>
    </div>
  )
}
