import { useEffect, useRef } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { AiLookupButton } from '@/components/AiLookupButton'
import { OnlineDictionaryButton } from '@/components/OnlineDictionaryButton'
import { StarButton } from '@/components/StarButton'
import { useDictionaryLookup } from '@/hooks/use-dictionary-entries'
import { useRecordQueryHistory } from '@/hooks/use-query-history'
import { useAppStore } from '@/stores/app-store'
import { useAiLookupConfig } from '@/hooks/use-ai-lookup'
import { useOnlineDictionaries } from '@/hooks/use-online-dictionaries'
import { SingleDictionaryResult } from './search-result/SingleDictionaryResult'
import { AggregateDictionaryResult } from './search-result/AggregateDictionaryResult'
import { SearchResultToolbar } from './search-result/SearchResultToolbar'

export function SearchResultPage(): React.JSX.Element {
  const location = useLocation()
  const { term } = useParams()
  const normalizedTerm = term?.trim()
  const dictionaryLayout = useAppStore((state) => state.dictionaryLayout)
  const recordedPathname = useRef<string | null>(null)
  const {
    data: group,
    isLoading,
    isFetching,
    isError,
    isPlaceholderData
  } = useDictionaryLookup(normalizedTerm)
  const aiConfig = useAiLookupConfig()
  const { data: onlineDictionaries = [] } = useOnlineDictionaries()
  const hasDictionaryEntries = Boolean(group?.dictionaries.length)
  const hasSearchActions = Boolean(
    onlineDictionaries.length || hasDictionaryEntries || aiConfig.data?.enabled
  )
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
  if (!normalizedTerm) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        选择一个词条查看详情
      </div>
    )
  }

  if (!dictionaryLayout) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        正在加载词典页面布局
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

  if (isError || !group || !hasDictionaryEntries) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {hasSearchActions && <SearchResultToolbar actions={searchActions} loading={isFetching} />}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <p className="text-sm font-medium">没有找到词条解释</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            所有词典中都没有找到 {normalizedTerm} 的解释
          </p>
        </div>
      </div>
    )
  }
  // Placeholder results still belong to the previous word. Keep that view until
  // the new lookup resolves instead of loading it with the old dictionary list.
  const resultTerm = group.word
  const props = {
    term: resultTerm,
    dictionaries: group.dictionaries,
    isFetching,
    actions: hasSearchActions ? searchActions : null
  }
  return dictionaryLayout === 'aggregate' ? (
    <AggregateDictionaryResult {...props} />
  ) : (
    <SingleDictionaryResult {...props} />
  )
}
