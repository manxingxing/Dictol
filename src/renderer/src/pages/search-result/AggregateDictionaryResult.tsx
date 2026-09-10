import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DictionaryTabIcon } from '@/components/DictionaryIcon'
import { SearchResultToolbar } from './SearchResultToolbar'
import {
  useDictionaryResultView,
  useDictionaryWordNavigation,
  type DictionaryResultProps
} from './use-dictionary-result-view'

export function AggregateDictionaryResult({
  term,
  dictionaries,
  isFetching,
  actions
}: DictionaryResultProps): React.JSX.Element {
  const [result, setResult] = useState<{ term: string; dictionaryId?: string; failed: boolean }>({
    term,
    failed: false
  })
  if (result.term !== term) setResult({ term, failed: false })
  const tabRef = useRef<HTMLButtonElement>(null)
  const { contentRef, loading } = useDictionaryResultView()
  useDictionaryWordNavigation()
  const selectedId =
    result.term === term && dictionaries.some((item) => item.dictionaryId === result.dictionaryId)
      ? result.dictionaryId
      : dictionaries[0]?.dictionaryId

  useEffect(
    () =>
      window.dictol.dictionaryView.onActiveDictionaryChanged((dictionaryId) => {
        if (dictionaries.some((item) => item.dictionaryId === dictionaryId)) {
          setResult((current) => ({ ...current, term, dictionaryId }))
        }
      }),
    [dictionaries, term]
  )

  useLayoutEffect(() => {
    tabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, term])

  useEffect(() => {
    let activeRequest = true
    void window.dictol.dictionaryView.showAggregate(term).catch(() => {
      if (!activeRequest) return
      window.dictol.dictionaryView.hide()
      setResult((current) => ({ ...current, term, failed: true }))
    })
    return () => {
      activeRequest = false
    }
  }, [term])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SearchResultToolbar actions={actions} loading={isFetching || loading}>
        <div
          aria-label="汇总词典导航"
          className="flex h-full shrink-0 items-center gap-1.5 pr-3"
          role="tablist"
        >
          {dictionaries.map((item) => (
            <button
              aria-label={item.dictionaryName}
              aria-selected={selectedId === item.dictionaryId}
              className="dictionary-tab-trigger group scroll-mx-3"
              data-state={selectedId === item.dictionaryId ? 'active' : 'inactive'}
              key={item.dictionaryId}
              ref={selectedId === item.dictionaryId ? tabRef : undefined}
              onClick={() => {
                setResult((current) => ({ ...current, term, dictionaryId: item.dictionaryId }))
                window.dictol.dictionaryView.scrollToDictionary(item.dictionaryId)
              }}
              role="tab"
              tabIndex={0}
              title={item.dictionaryName}
              type="button"
            >
              <DictionaryTabIcon iconUrl={item.dictionaryIconUrl} name={item.dictionaryName} />
            </button>
          ))}
        </div>
      </SearchResultToolbar>
      <div aria-label="多词典汇总词条内容" className="min-h-0 flex-1" ref={contentRef}>
        {result.failed && (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            无法读取词典汇总内容
          </div>
        )}
      </div>
    </div>
  )
}
