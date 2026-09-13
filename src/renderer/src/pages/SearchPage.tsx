import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { useReadyDictionaries } from '@/hooks/use-dictionaries'
import { EmptyDictionaryState } from './EmptyDictionaryState'
import { DictionaryIndexMigrationState } from './DictionaryIndexMigrationState'
import { SearchLayout } from '@/components/SearchLayout'
import { useAppStore } from '@/stores/app-store'

export function SearchPage(): React.JSX.Element {
  const { data: dictionaries = [], isLoading, isError } = useReadyDictionaries()
  const setLastQueryPath = useAppStore((state) => state.setLastQueryPath)
  const location = useLocation()

  useEffect(() => {
    const unsubscribe = window.dictol.app.onShowFindBar(() =>
      window.dictol.dictionaryView.showFindBar()
    )
    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const currentLocation = `${location.pathname}${location.search}${location.hash}`
    setLastQueryPath(currentLocation)
  }, [setLastQueryPath, location])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        正在加载词典…
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        加载词典失败，请稍后重试。
      </div>
    )
  }

  if (dictionaries.length === 0) {
    return <EmptyDictionaryState />
  }

  const pendingIndexes = dictionaries.filter(
    (
      dictionary
    ): dictionary is typeof dictionary & {
      indexStatus: 'building' | 'error' | 'needs_reindex' | 'missing'
    } => dictionary.indexStatus !== 'ready'
  )
  if (pendingIndexes.length > 0) {
    return <DictionaryIndexMigrationState dictionaries={pendingIndexes} />
  }

  return <SearchLayout />
}
