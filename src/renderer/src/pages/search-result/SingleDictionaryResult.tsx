import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  anchor,
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
  const activeDictionaryRef = useRef<HTMLButtonElement>(null)
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
    activeDictionaryRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [dictionaryId, term])

  useEffect(() => {
    if (isPlaceholderData) return
    let activeRequest = true
    void window.dictol.dictionaryView.show({ dictionaryId, term, anchor }).catch(() => {
      if (!activeRequest) return
      window.dictol.dictionaryView.hide()
      setResult({ dictionaryId, term, failed: true })
    })
    return () => {
      activeRequest = false
    }
  }, [anchor, dictionaryId, groupId, isPlaceholderData, term])

  useEffect(
    () =>
      window.dictol.dictionaryView.onSwitchDictionary(({ direction, dictionaryId: sourceId }) => {
        if (isPlaceholderData || sourceId !== dictionaryId) return
        const index = dictionaries.findIndex((item) => item.dictionaryId === sourceId)
        const nextDictionary = dictionaries[index + (direction === 'right' ? 1 : -1)]
        if (!nextDictionary) return
        const next = new URLSearchParams(searchParams)
        next.set('dictionaryId', nextDictionary.dictionaryId)
        setSearchParams(next, { replace: true })
      }),
    [dictionaries, dictionaryId, isPlaceholderData, searchParams, setSearchParams]
  )

  const failed = result.failed
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SearchResultToolbar actions={actions} loading={isFetching || loading}>
        <div className="flex h-full shrink-0 items-center gap-1.5 px-3">
          {dictionaries.map((item) => (
            <button
              aria-label={item.dictionaryName}
              aria-pressed={item.dictionaryId === dictionaryId}
              className="dictionary-tab-trigger group inline-flex cursor-default items-center justify-center scroll-mx-3"
              data-state={item.dictionaryId === dictionaryId ? 'active' : 'inactive'}
              key={item.dictionaryId}
              onClick={() => {
                if (item.dictionaryId === dictionaryId) return
                const next = new URLSearchParams(searchParams)
                next.set('dictionaryId', item.dictionaryId)
                setSearchParams(next, { replace: true })
              }}
              ref={item.dictionaryId === dictionaryId ? activeDictionaryRef : undefined}
              type="button"
            >
              <DictionaryTabIcon
                display={dictionaryDisplay}
                iconUrl={item.dictionaryIconUrl}
                name={item.dictionaryName}
                showTooltip
              />
            </button>
          ))}
        </div>
      </SearchResultToolbar>
      <div
        className="min-h-0 flex-1"
        ref={contentRef}
        role="region"
        aria-label={`${active.dictionaryName} 词条内容`}
      >
        {failed && (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            无法读取这个词典中的词条
          </div>
        )}
      </div>
    </div>
  )
}
