import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DictionaryTabIcon } from '@/components/DictionaryIcon'
import { useAppStore } from '@/stores/app-store'
import { SearchResultToolbar } from './SearchResultToolbar'
import {
  useDictionaryResultView,
  useDictionaryWordNavigation,
  type DictionaryResultProps
} from './use-dictionary-result-view'

export function SingleDictionaryResult({
  term,
  dictionaries,
  isFetching,
  isPlaceholderData,
  groupId,
  actions
}: DictionaryResultProps): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedId = searchParams.get('dictionaryId')
  const active = dictionaries.find((item) => item.dictionaryId === requestedId) ?? dictionaries[0]!
  const dictionaryId = active.dictionaryId
  const dictionaryDisplay = useAppStore((state) => state.dictionaryDisplay) ?? 'icon'
  const [result, setResult] = useState({ term, dictionaryId, failed: false })
  if (result.term !== term || result.dictionaryId !== dictionaryId) {
    setResult({ term, dictionaryId, failed: false })
  }
  const tabRef = useRef<HTMLButtonElement>(null)
  const { contentRef, loading } = useDictionaryResultView()
  useDictionaryWordNavigation(dictionaryId)

  useEffect(() => {
    if (requestedId === dictionaryId) return
    const next = new URLSearchParams(searchParams)
    next.set('dictionaryId', dictionaryId)
    setSearchParams(next, { replace: true })
  }, [dictionaryId, requestedId, searchParams, setSearchParams])

  // 词典图标栏自动滚动当前词典图标处
  useLayoutEffect(() => {
    tabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [dictionaryId, term])

  useEffect(() => {
    if (isPlaceholderData) return
    let activeRequest = true
    void window.dictol.dictionaryView.show({ dictionaryId, term }).catch(() => {
      if (!activeRequest) return
      window.dictol.dictionaryView.hide()
      setResult({ dictionaryId, term, failed: true })
    })
    return () => {
      activeRequest = false
    }
  }, [dictionaryId, groupId, isPlaceholderData, term])

  const failed = result.failed
  return (
    <Tabs
      className="h-full min-h-0 gap-0 bg-background"
      value={dictionaryId}
      onValueChange={(id) => {
        const next = new URLSearchParams(searchParams)
        next.set('dictionaryId', id)
        setSearchParams(next, { replace: true })
      }}
    >
      <SearchResultToolbar actions={actions} loading={isFetching || loading}>
        <TabsList className="h-full shrink-0 gap-1.5 bg-transparent p-0 pr-3">
          {dictionaries.map((item) => (
            <TabsTrigger
              aria-label={item.dictionaryName}
              className="dictionary-tab-trigger group scroll-mx-3"
              key={item.dictionaryId}
              ref={item.dictionaryId === dictionaryId ? tabRef : undefined}
              tabIndex={0}
              value={item.dictionaryId}
            >
              <DictionaryTabIcon
                display={dictionaryDisplay}
                iconUrl={item.dictionaryIconUrl}
                name={item.dictionaryName}
                showTooltip
              />
            </TabsTrigger>
          ))}
        </TabsList>
      </SearchResultToolbar>
      <div
        className="min-h-0 flex-1"
        ref={contentRef}
        role="tabpanel"
        aria-label={`${active.dictionaryName} 词条内容`}
      >
        {failed && (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            无法读取这个词典中的词条
          </div>
        )}
      </div>
    </Tabs>
  )
}
