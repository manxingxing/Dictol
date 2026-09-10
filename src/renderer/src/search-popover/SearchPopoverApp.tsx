import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LoaderCircle, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useChromeTone } from '@/hooks/use-chrome-tone'
import { cn } from '@/lib/utils'
import { SEARCH_POPOVER_SUGGESTION_LIST_MAX_HEIGHT } from '../../../shared/search-popover'
import { MAIN_WINDOW_TITLEBAR_CONTROL_HEIGHT } from '../../../shared/window-chrome'

type SearchPopoverItem = {
  word: string
  description: string
  recent: boolean
}

type SearchPopoverPayload = {
  query: string
  items: SearchPopoverItem[]
  selectedIndex: number
  status?: 'loading' | 'empty'
}

declare global {
  interface Window {
    dictolSearchPopover: {
      onUpdate: (callback: (payload: SearchPopoverPayload) => void) => () => void
      onFocus: (callback: () => void) => () => void
      changeQuery: (query: string) => void
      select: (word: string) => void
      submit: (query: string) => void
      dismiss: () => void
    }
  }
}

const initialPayload: SearchPopoverPayload = {
  query: '',
  items: [],
  selectedIndex: -1
}

export function SearchPopoverApp(): React.JSX.Element {
  useChromeTone()

  const inputRef = useRef<HTMLInputElement>(null)
  const latestPayloadRef = useRef<SearchPopoverPayload>(initialPayload)
  const [payload, setPayload] = useState<SearchPopoverPayload>(initialPayload)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [focusRequest, setFocusRequest] = useState(0)
  const optionRefs = useRef(new Map<number, HTMLButtonElement>())

  useEffect(
    () =>
      window.dictolSearchPopover.onUpdate((nextPayload) => {
        latestPayloadRef.current = nextPayload
        setPayload(nextPayload)
        setSelectedIndex(nextPayload.selectedIndex)
      }),
    []
  )

  useEffect(
    () =>
      window.dictolSearchPopover.onFocus(() => {
        const nextPayload = latestPayloadRef.current
        setQuery(nextPayload.query)
        setSelectedIndex(nextPayload.selectedIndex)
        setFocusRequest((request) => request + 1)
      }),
    []
  )

  useLayoutEffect(() => {
    if (focusRequest === 0) return
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
  }, [focusRequest])

  useEffect(() => {
    if (selectedIndex < 0) return
    optionRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
  }, [payload.items, payload.query, selectedIndex])

  const updateQuery = (nextQuery: string): void => {
    setQuery(nextQuery)
    setSelectedIndex(0)
    window.dictolSearchPopover.changeQuery(nextQuery)
  }

  const openSelectedItem = (): void => {
    const item = payload.items[selectedIndex]
    if (item) {
      window.dictolSearchPopover.select(item.word)
      return
    }
    window.dictolSearchPopover.submit(query)
  }

  const hasSuggestions = payload.items.length > 0 || payload.status !== undefined

  return (
    <div className="no-drag fixed top-0 left-3 w-[calc(100vw-24px)]">
      <div className="relative">
        {payload.status === 'loading' ? (
          <LoaderCircle className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <Input
          ref={inputRef}
          aria-controls="search-popover-suggestions"
          aria-expanded={hasSuggestions}
          aria-label="搜索单词"
          autoFocus
          className="no-drag border-[var(--border-strong)] bg-card px-9 shadow-none"
          maxLength={200}
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              window.dictolSearchPopover.dismiss()
              return
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (payload.items.length === 0) return
              event.preventDefault()
              const direction = event.key === 'ArrowDown' ? 1 : -1
              setSelectedIndex(
                (current) =>
                  (Math.max(0, current) + direction + payload.items.length) % payload.items.length
              )
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              openSelectedItem()
            }
          }}
          placeholder="搜索单词…"
          role="combobox"
          style={{ height: MAIN_WINDOW_TITLEBAR_CONTROL_HEIGHT }}
          value={query}
        />
        {query.length > 0 && (
          <Button
            aria-label="清空搜索"
            className="no-drag absolute right-1.5 top-1/2 z-10 size-7 -translate-y-1/2 rounded-md text-muted-foreground hover:text-foreground"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              updateQuery('')
              inputRef.current?.focus({ preventScroll: true })
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

      {hasSuggestions && (
        <div
          aria-label="搜索建议"
          className="mt-[3px] overflow-hidden rounded-lg border border-border bg-card p-1 text-foreground shadow-md"
          id="search-popover-suggestions"
          role="listbox"
        >
          <div
            className="max-h-[420px] overflow-y-auto overscroll-contain"
            style={{ maxHeight: SEARCH_POPOVER_SUGGESTION_LIST_MAX_HEIGHT }}
          >
            {payload.items.length === 0 && payload.status ? (
              <div
                className="flex h-[42px] items-center px-2 text-sm text-muted-foreground"
                role="status"
              >
                {payload.status === 'loading' ? '正在搜索…' : '没有找到匹配的词条'}
              </div>
            ) : (
              payload.items.map((item, index) => {
                const selected = index === selectedIndex

                return (
                  <button
                    ref={(element) => {
                      if (element) optionRefs.current.set(index, element)
                      else optionRefs.current.delete(index)
                    }}
                    aria-selected={selected}
                    className={cn(
                      'grid h-[42px] w-full cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 text-left text-sm outline-none select-none hover:bg-muted focus-visible:bg-muted',
                      selected &&
                        'bg-primary/10 text-primary hover:bg-primary/10 focus-visible:bg-primary/10'
                    )}
                    key={`${item.word}:${index}`}
                    onClick={() => window.dictolSearchPopover.select(item.word)}
                    onPointerMove={() => setSelectedIndex(index)}
                    role="option"
                    type="button"
                  >
                    <span className="truncate font-medium">{item.word}</span>
                    <span
                      className={cn(
                        'text-xs whitespace-nowrap text-muted-foreground',
                        selected && 'text-primary/70'
                      )}
                    >
                      {item.description}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
