import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DictionaryTabIcon } from '@/components/DictionaryIcon'
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
  actions
}: DictionaryResultProps): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedId = searchParams.get('dictionary')
  const active = dictionaries.find((item) => item.dictionaryId === requestedId) ?? dictionaries[0]!
  const dictionaryId = active.dictionaryId
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
    next.set('dictionary', dictionaryId)
    setSearchParams(next, { replace: true })
  }, [dictionaryId, requestedId, searchParams, setSearchParams])

  useLayoutEffect(() => {
    tabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [dictionaryId, term])

  useEffect(() => {
    let activeRequest = true
    void window.dictol.dictionaryView.show({ dictionaryId, term }).catch(() => {
      if (!activeRequest) return
      window.dictol.dictionaryView.hide()
      setResult({ dictionaryId, term, failed: true })
    })
    return () => {
      activeRequest = false
    }
  }, [dictionaryId, term])

  const failed = result.failed
  return (
    <Tabs
      className="h-full min-h-0 gap-0 bg-background"
      value={dictionaryId}
      onValueChange={(id) => {
        const next = new URLSearchParams(searchParams)
        next.set('dictionary', id)
        setSearchParams(next)
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
              title={item.dictionaryName}
              value={item.dictionaryId}
            >
              <DictionaryTabIcon iconUrl={item.dictionaryIconUrl} name={item.dictionaryName} />
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
