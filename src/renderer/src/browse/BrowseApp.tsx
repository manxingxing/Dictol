import { Button } from '@/components/ui/button'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CircleChevronRight, LoaderCircle, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import useDebounce from 'react-use/lib/useDebounce'

export function BrowseApp(): React.JSX.Element {
  const dictionaryId = useMemo(
    () => new URLSearchParams(window.location.search).get('dictionaryId'),
    []
  )
  const [dictionaryName, setDictionaryName] = useState<string | null>(null)
  const [words, setWords] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const [isLoading, setIsLoading] = useState(Boolean(dictionaryId))
  const [error, setError] = useState<string | null>(dictionaryId ? null : '缺少词典 ID')
  const listRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: words.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 40,
    getItemKey: (index) => `${index}:${words[index]}`,
    overscan: 20
  })

  useDebounce(() => setDebouncedQuery(query), 200, [query])

  useEffect(() => {
    if (!dictionaryId) return
    void window.dictolBrowse.getDictionaryName(dictionaryId).then(setDictionaryName)
  }, [dictionaryId])

  useEffect(() => {
    if (!dictionaryId) return
    const prefix = debouncedQuery
    let cancelled = false
    const request = prefix
      ? window.dictolBrowse.prefixEntryWords(dictionaryId, prefix)
      : window.dictolBrowse.listEntryWords(dictionaryId)

    void request
      .then(matches => {
        if (cancelled) return
        setWords(matches)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '加载词条失败')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [dictionaryId, debouncedQuery])

  useEffect(() => {
    rowVirtualizer.measure()
  }, [rowVirtualizer, words])

  return (
    <main className="mx-auto flex h-screen min-h-0 max-w-3xl flex-col p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">{dictionaryName ?? '本地词典'}</h1>
      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-label="筛选词条"
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入前缀筛选词条…"
          value={query}
        />
      </div>
      <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        {isLoading && (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            正在加载全部词条…
          </p>
        )}
        {!isLoading && error && <p className="px-4 py-6 text-sm text-destructive">{error}</p>}
        {!isLoading && !error && (
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            <ul
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => (
                <li
                  className="absolute left-0 top-0 flex h-10 w-full items-center justify-between whitespace-nowrap border-b border-border pl-4 pr-3 text-sm group hover:bg-muted/40"
                  data-index={virtualRow.index}
                  key={virtualRow.key}
                  style={{
                    transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                    boxSizing: 'border-box'
                  }}
                >
                  {words[virtualRow.index]}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden group-hover:inline-flex bg-transparent"
                    onClick={() =>
                      dictionaryId && window.dictolBrowse.lookup(dictionaryId, words[virtualRow.index])
                    }
                  >
                    <CircleChevronRight />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  )
}
