import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AiLookupButton } from '@/components/AiLookupButton'
import { OnlineDictionaryButton } from '@/components/OnlineDictionaryButton'
import { StarButton } from '@/components/StarButton'
import { useDictionaryLookup } from '@/hooks/use-dictionary-entries'
import { useRecordQueryHistory } from '@/hooks/use-query-history'
import { useAppStore } from '@/stores/app-store'
import { useAiLookupConfig } from '@/hooks/use-ai-lookup'
import { useOnlineDictionaries } from '@/hooks/use-online-dictionaries'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { DictionaryTabIcon } from '@/components/DictionaryIcon'

export function SearchResultPage(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const { term } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)

  const [contentContainer, setContentContainer] = useState<HTMLDivElement | null>(null)
  const [dictionaryViewLoading, setDictionaryViewLoading] = useState(false)
  const contentContainerRef = useCallback((node: HTMLDivElement | null): void => {
    setContentContainer(node)
  }, [])

  const recordedPathname = useRef<string | null>(null)
  const activeDictionaryTabRef = useRef<HTMLButtonElement | null>(null)
  const normalizedTerm = term?.trim()

  const {
    data: group,
    isLoading,
    isFetching,
    isError,
    isPlaceholderData
  } = useDictionaryLookup(normalizedTerm)

  const aiConfig = useAiLookupConfig()

  const { data: onlineDictionaries = [] } = useOnlineDictionaries()

  const requestedDictionaryId = searchParams.get('dictionary')
  const activeDictionary =
    group?.dictionaries.find((item) => item.dictionaryId === requestedDictionaryId) ??
    group?.dictionaries[0]

  const activeEntryId = activeDictionary?.entryId
  const hasDictionaryEntries = Boolean(group && group.dictionaries.length > 0)
  const hasSearchActions = Boolean(
    onlineDictionaries.length > 0 || hasDictionaryEntries || aiConfig.data?.enabled
  )
  const [entryFailure, setEntryFailure] = useState({
    entryId: activeEntryId,
    failed: false
  })

  if (entryFailure.entryId !== activeEntryId) {
    setEntryFailure({ entryId: activeEntryId, failed: false })
  }

  // 词典tab滚动到当前 active 词典
  useLayoutEffect(() => {
    activeDictionaryTabRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    })
  }, [activeDictionary?.dictionaryId, normalizedTerm])

  const { mutateAsync: recordQueryHistory } = useRecordQueryHistory()
  useEffect(() => {
    if (!group || isPlaceholderData || recordedPathname.current === location.pathname) {
      return
    }
    recordedPathname.current = location.pathname
    void recordQueryHistory(group.word).catch((error: unknown) => {
      console.error('Failed to record query history', error)
    })
  }, [group, isPlaceholderData, location.pathname, recordQueryHistory])

  useEffect(() => {
    if (!activeDictionary || requestedDictionaryId === activeDictionary.dictionaryId) return
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('dictionary', activeDictionary.dictionaryId)
    setSearchParams(nextSearchParams, { replace: true })
  }, [activeDictionary, requestedDictionaryId, searchParams, setSearchParams])

  useEffect(() => {
    return window.dictol.dictionaryView.onLookupWord((value) => {
      const word = value.trim()
      if (!word) return
      setSearchQuery(word)
      const nextSearchParams = new URLSearchParams()
      if (activeDictionary) nextSearchParams.set('dictionary', activeDictionary.dictionaryId)
      const queryString = nextSearchParams.toString()
      void navigate(`/search/${encodeURIComponent(word)}${queryString ? `?${queryString}` : ''}`)
    })
  }, [activeDictionary, navigate, setSearchQuery])

  useEffect(() => window.dictol.dictionaryView.onLoadingChanged(setDictionaryViewLoading), [])

  useEffect(() => {
    if (!activeEntryId) {
      if (!isFetching) window.dictol.dictionaryView.hide()
      return
    }
    let active = true
    void window.dictol.dictionaryView.show(activeEntryId).catch(() => {
      if (active) {
        window.dictol.dictionaryView.hide()
        setEntryFailure({ entryId: activeEntryId, failed: true })
      }
    })
    return () => {
      active = false
    }
  }, [activeEntryId, isFetching])

  useEffect(() => () => window.dictol.dictionaryView.hide(), [])

  useLayoutEffect(() => {
    const container = contentContainer
    if (!container || !activeEntryId) return

    let animationFrame = 0

    const updateBounds = (): void => {
      const bounds = container.getBoundingClientRect()
      window.dictol.dictionaryView.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      })
    }
    const scheduleBoundsUpdate = (): void => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        updateBounds()
      })
    }
    const observer = new ResizeObserver(scheduleBoundsUpdate)
    observer.observe(container)
    scheduleBoundsUpdate()
    return () => {
      observer.disconnect()
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
    }
  }, [activeEntryId, contentContainer])

  if (!normalizedTerm) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        选择一个词条查看详情
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        正在查询多个词典…
      </div>
    )
  }

  const searchActions = (
    <div
      aria-label="查询和操作"
      className="search-action-dock flex h-10 shrink-0 items-center gap-1 rounded-xl p-1.5"
    >
      {onlineDictionaries.length > 0 && (
        <div
          aria-label="在线词典"
          className="online-dictionary-collapse group/online-dictionary-collapse shrink-0"
          style={
            {
              '--online-dictionary-expanded-width': `${onlineDictionaries.length * 32}px`
            } as React.CSSProperties
          }
        >
          <div className="online-dictionary-options flex items-center gap-1">
            {onlineDictionaries.map((dictionary, index) => (
              <OnlineDictionaryButton
                dictionary={dictionary}
                key={dictionary.id}
                searchTerm={normalizedTerm}
                zIndex={onlineDictionaries.length - index}
              />
            ))}
          </div>
        </div>
      )}
      {hasDictionaryEntries && <StarButton word={group?.word} />}
      {aiConfig.data?.enabled && <AiLookupButton term={normalizedTerm} />}
    </div>
  )
  const isDictionaryContentLoading = isFetching || dictionaryViewLoading

  if (isError || !group || !hasDictionaryEntries) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {hasSearchActions && (
          <div className="relative flex h-14 shrink-0 items-center border-b border-border bg-[var(--dictionary-toolbar-background)] px-3">
            <div className="min-w-0 flex-1" />
            {searchActions}
            {isDictionaryContentLoading && <DictionaryViewLoadingIndicator />}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <p className="text-sm font-medium">没有找到词条解释</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            所有词典中都没有找到 {normalizedTerm} 的解释
          </p>
        </div>
      </div>
    )
  }

  return (
    <Tabs
      className="h-full min-h-0 gap-0 bg-background"
      onValueChange={(dictionaryId) => {
        const nextSearchParams = new URLSearchParams(searchParams)
        nextSearchParams.set('dictionary', dictionaryId)
        setSearchParams(nextSearchParams)
      }}
      value={activeDictionary?.dictionaryId}
    >
      <div className="relative flex h-14 shrink-0 items-center overflow-visible border-b border-border bg-[var(--dictionary-toolbar-background)] px-3">
        <ScrollArea
          className="h-full min-w-0 flex-1 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-3 after:bg-linear-to-r after:from-transparent after:to-[var(--dictionary-toolbar-background)] after:content-['']"
          showVerticalScrollbar={false}
          viewportClassName="[&>div]:h-full"
        >
          <TabsList className="h-full shrink-0 gap-1.5 bg-transparent p-0 pr-3">
            {group.dictionaries.map((item) => (
              <TabsTrigger
                aria-label={item.dictionaryName}
                className="dictionary-tab-trigger group scroll-mx-3"
                key={item.dictionaryId}
                ref={
                  item.dictionaryId === activeDictionary?.dictionaryId
                    ? activeDictionaryTabRef
                    : undefined
                }
                tabIndex={0}
                title={item.dictionaryName}
                value={item.dictionaryId}
              >
                <DictionaryTabIcon iconUrl={item.dictionaryIconUrl} name={item.dictionaryName} />
              </TabsTrigger>
            ))}
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        {hasSearchActions && <>{searchActions}</>}
        {isDictionaryContentLoading && <DictionaryViewLoadingIndicator />}
      </div>
      <div className="min-h-0 flex-1" ref={contentContainerRef}>
        {group.dictionaries.map((item) => (
          <TabsContent
            className="m-0 h-full min-h-0 data-[state=inactive]:hidden"
            key={item.dictionaryId}
            value={item.dictionaryId}
          >
            {entryFailure.entryId === item.entryId && entryFailure.failed ? (
              <div className="flex h-full items-center justify-center text-sm text-destructive">
                无法读取这个词典中的词条
              </div>
            ) : (
              <div
                className="h-full w-full bg-background"
                aria-label={`${item.dictionaryName} 词条内容`}
              />
            )}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  )
}

function DictionaryViewLoadingIndicator(): React.JSX.Element {
  return (
    <div
      aria-label="词条内容正在加载"
      className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-0.5 overflow-hidden"
      role="progressbar"
    >
      <div className="native-view-loading-indicator h-full bg-primary" />
    </div>
  )
}
