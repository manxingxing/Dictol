import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { Globe2, LoaderCircle, Search, X } from 'lucide-react'
import useDebounce from 'react-use/lib/useDebounce'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

import { useDictionarySearch } from '@/hooks/use-dictionary-entries'
import { useOnlineDictionaries } from '@/hooks/use-online-dictionaries'
import { useQueryHistory } from '@/hooks/use-query-history'
import { useSearchShortCut } from '@/hooks/use-search-shortcut'
import { RIGHT_SIDEBAR_MAX_SIZE, selectCompactMode, useAppStore } from '@/stores/app-store'
import { SearchHistory } from '@/components/SearchHistory'
import { isVisible } from '@/lib/utils'

export const SearchPanel = (): React.JSX.Element => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const searchQuery = useAppStore((state) => state.searchQuery)
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen)
  const setRightSidebarType = useAppStore((state) => state.setRightSidebarType)
  const setEmbedBrowserSearchTerm = useAppStore((state) => state.setEmbedBrowserSearchTerm)
  const setEmbedBrowserUrl = useAppStore((state) => state.setEmbedBrowserUrl)
  const setRightSidebarSize = useAppStore((state) => state.setRightSidebarSize)
  const displayInCompactMode = useAppStore(selectCompactMode)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const focusSearchInput = useCallback((): boolean => {
    const input = searchInputRef.current
    if (!input || !isVisible(input)) return false
    input.focus({ preventScroll: true })
    input.select()
    return true
  }, [])
  useSearchShortCut(focusSearchInput)

  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery)
  useDebounce(() => setDebouncedQuery(searchQuery.trim()), 100, [searchQuery])

  const { data: results = [], isFetching } = useDictionarySearch(debouncedQuery)
  const { data: onlineDictionaries = [] } = useOnlineDictionaries()
  const { data: history = [] } = useQueryHistory()
  const createSearchResultPath = useCallback(
    (word: string): string => {
      const dictionaryId = searchParams.get('dictionary')
      const query = dictionaryId ? `?${new URLSearchParams({ dictionary: dictionaryId })}` : ''
      return `/search/${encodeURIComponent(word)}${query}`
    },
    [searchParams]
  )

  const normalizedQuery = searchQuery.trim()
  const hasQuery = normalizedQuery.length > 0
  const recentHistory = history.slice(0, 50)
  const candidateCount = hasQuery ? results.length : recentHistory.length
  const selectionKey = `${hasQuery ? 'results' : 'history'}:${normalizedQuery}:${debouncedQuery}:${candidateCount}`
  const [selectionState, setSelectionState] = useState({ key: '', index: -1 })
  const selectedCandidateIndex = selectionState.key === selectionKey ? selectionState.index : -1
  const resultItemRefs = useRef<Array<HTMLLIElement | null>>([])

  useLayoutEffect(() => {
    if (!hasQuery || selectedCandidateIndex < 0) return
    resultItemRefs.current[selectedCandidateIndex]?.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest'
    })
  }, [hasQuery, selectedCandidateIndex])

  const updateSelectedCandidateIndex = useCallback(
    (update: (current: number) => number): void => {
      setSelectionState((currentState) => {
        const currentIndex = currentState.key === selectionKey ? currentState.index : -1
        return { key: selectionKey, index: update(currentIndex) }
      })
    },
    [selectionKey]
  )

  const setSelectedCandidateIndex = useCallback(
    (index: number): void => {
      updateSelectedCandidateIndex(() => index)
    },
    [updateSelectedCandidateIndex]
  )

  const openFirstResult = useCallback(async (): Promise<void> => {
    if (!normalizedQuery) return
    const first =
      debouncedQuery.toLowerCase() === normalizedQuery.toLowerCase() && !isFetching
        ? results[0]
        : undefined
    const currentFirst =
      first ?? (await window.dictol.entries.search(normalizedQuery, 1).then((items) => items[0]))
    await navigate(createSearchResultPath(currentFirst?.word ?? normalizedQuery))
  }, [createSearchResultPath, debouncedQuery, isFetching, navigate, normalizedQuery, results])

  const openSelectedCandidate = useCallback(async (): Promise<void> => {
    if (!hasQuery) {
      const historyItem = recentHistory[selectedCandidateIndex]
      if (!historyItem) return
      setSearchQuery(historyItem.term)
      await navigate(createSearchResultPath(historyItem.term))
      return
    }

    const selectedResult = results[selectedCandidateIndex]
    if (
      selectedResult &&
      !isFetching &&
      debouncedQuery.toLowerCase() === normalizedQuery.toLowerCase()
    ) {
      await navigate(createSearchResultPath(selectedResult.word))
      return
    }

    await openFirstResult()
  }, [
    createSearchResultPath,
    debouncedQuery,
    hasQuery,
    isFetching,
    navigate,
    normalizedQuery,
    openFirstResult,
    recentHistory,
    results,
    selectedCandidateIndex,
    setSearchQuery
  ])

  const hasCandidates = results.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--panel-background)]">
      <div className="border-b border-border px-3.5 py-4">
        <div className="relative">
          {isFetching ? (
            <LoaderCircle className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          )}

          <Input
            ref={searchInputRef}
            aria-label="搜索单词"
            autoFocus={!displayInCompactMode}
            className="h-9 border-[var(--border-strong)] bg-card px-9 shadow-none"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (candidateCount === 0) return
                event.preventDefault()
                const direction = event.key === 'ArrowDown' ? 1 : -1
                updateSelectedCandidateIndex((current) =>
                  current < 0
                    ? direction === 1
                      ? 0
                      : candidateCount - 1
                    : (current + direction + candidateCount) % candidateCount
                )
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                void openSelectedCandidate().catch((error: unknown) => {
                  console.error('Failed to open the selected dictionary result', error)
                })
              }
            }}
            placeholder="搜索单词…"
            value={searchQuery}
          />
          {searchQuery.length > 0 && (
            <Button
              aria-label="清空搜索"
              className="absolute right-1.5 top-1/2 size-7 -translate-y-1/2 rounded-md text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchQuery('')
                searchInputRef.current?.focus()
              }}
              size="icon"
              title="清空搜索"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        {!hasQuery ? (
          <SearchHistory
            history={history}
            onPointerMove={setSelectedCandidateIndex}
            selectedIndex={selectedCandidateIndex}
          />
        ) : !hasCandidates && !isFetching ? (
          onlineDictionaries.length > 0 ? (
            <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:!block">
              <section aria-labelledby="online-dictionary-searches">
                <h2
                  className="px-3 pb-1 text-xs font-medium text-muted-foreground"
                  id="online-dictionary-searches"
                >
                  在线词典
                </h2>
                <ul className="space-y-1">
                  {onlineDictionaries.map((dictionary) => (
                    <li key={dictionary.id}>
                      <Button
                        aria-label={`在 ${dictionary.name} 中查找 ${normalizedQuery}`}
                        className="h-9 w-full justify-start px-3 text-left"
                        onClick={() => {
                          const url = dictionary.urlTemplate
                            .split('%s')
                            .join(encodeURIComponent(normalizedQuery))
                          setEmbedBrowserSearchTerm(normalizedQuery)
                          setEmbedBrowserUrl(url)
                          setRightSidebarType('embed-browser')
                          setRightSidebarOpen(true)
                          setRightSidebarSize(RIGHT_SIDEBAR_MAX_SIZE)
                        }}
                        title={`在 ${dictionary.name} 中查找`}
                        type="button"
                        variant="ghost"
                      >
                        <span className="relative mr-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-background">
                          <img
                            alt=""
                            className="size-full rounded-full object-cover"
                            onError={(event) => {
                              event.currentTarget.style.display = 'none'
                              event.currentTarget.nextElementSibling?.classList.remove('hidden')
                            }}
                            src={dictionary.faviconUrl}
                          />
                          <Globe2 className="absolute hidden size-3 text-muted-foreground" />
                        </span>
                        <span className="truncate">在 {dictionary.name} 中查找</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            </ScrollArea>
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              没有找到匹配的词条
            </p>
          )
        ) : (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:!block">
            <ul className="space-y-1">
              {results.map((result, index) => (
                <li
                  key={result.normalizedWord}
                  ref={(element) => {
                    resultItemRefs.current[index] = element
                  }}
                >
                  <NavLink className="block" to={createSearchResultPath(result.word)}>
                    {({ isActive }) => (
                      <Button
                        className={`h-auto w-full justify-start px-3 py-2 text-left ${
                          selectedCandidateIndex === index
                            ? 'bg-primary/10 font-medium text-primary ring-1 ring-inset ring-primary/20'
                            : selectedCandidateIndex < 0 && isActive
                              ? 'bg-primary/12 font-medium text-primary ring-1 ring-inset ring-primary/20'
                              : 'text-foreground'
                        }`}
                        onPointerMove={() => setSelectedCandidateIndex(index)}
                        variant="ghost"
                      >
                        <span className="flex min-w-0 flex-col items-start gap-0.5">
                          <span className="truncate">{result.word}</span>
                        </span>
                      </Button>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
