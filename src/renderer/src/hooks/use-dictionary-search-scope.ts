import { useCallback, useEffect, useRef, useState } from 'react'
import type { DictionarySearchScopeSource } from '../../../shared/dictionary-search-scope'

export type DictionarySearchScope = {
  id: string | null
  name: string
  dictionaryCount: number | null
}

const ALL_DICTIONARY_SEARCH_SCOPE: DictionarySearchScope = {
  id: null,
  name: '全部',
  dictionaryCount: null
}

export function useDictionarySearchScope(
  scopes: readonly DictionarySearchScope[],
  source?: DictionarySearchScopeSource
): {
  scopeId: string | null
  selectedScope: DictionarySearchScope
  selectScope: (scope: DictionarySearchScope) => void
} {
  const [scopeId, setScopeId] = useState<string | null>(null)
  const scopeVersion = useRef(0)

  useEffect(() => {
    let active = true
    const unsubscribe = window.dictol.dictionarySearchScope.onChanged((change) => {
      if (change.source === source) return
      scopeVersion.current += 1
      setScopeId(change.groupId)
    })

    const readVersion = scopeVersion.current
    void window.dictol.dictionarySearchScope
      .get()
      .then((nextScopeId) => {
        if (active && scopeVersion.current === readVersion) setScopeId(nextScopeId)
      })
      .catch((error: unknown) => {
        console.error('Failed to read dictionary search scope', error)
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const selectScope = useCallback((nextScope: DictionarySearchScope): void => {
    const requestVersion = ++scopeVersion.current
    setScopeId(nextScope.id)
    void window.dictol.dictionarySearchScope
      .set(nextScope.id, source ?? 'search-panel')
      .then((confirmedScopeId) => {
        if (scopeVersion.current === requestVersion) setScopeId(confirmedScopeId)
      })
      .catch((error: unknown) => {
        console.error('Failed to update dictionary search scope', error)
      })
  }, [])

  const selectedScope =
    scopes.find((scope) => scope.id === scopeId) ?? scopes[0] ?? ALL_DICTIONARY_SEARCH_SCOPE

  return { scopeId, selectedScope, selectScope }
}
