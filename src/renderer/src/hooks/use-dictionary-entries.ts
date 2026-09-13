import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'

export type DictionarySearchResult = Awaited<
  ReturnType<Window['dictol']['entries']['search']>
>[number]
export type DictionaryEntryGroup = Awaited<ReturnType<Window['dictol']['entries']['lookup']>>

export function useDictionarySearch(
  prefix: string,
  limit = 50,
  groupId: string | null = null
): UseQueryResult<DictionarySearchResult[], Error> {
  const normalizedPrefix = prefix.trim()
  return useQuery({
    queryKey: ['dictionary-entries', 'prefix', normalizedPrefix.toLowerCase(), limit, groupId],
    queryFn: () => window.dictol.entries.search(normalizedPrefix, limit, groupId),
    enabled: normalizedPrefix.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0
  })
}

export function useDictionaryLookup(
  term: string | undefined,
  groupId: string | null = null
): UseQueryResult<DictionaryEntryGroup, Error> {
  const normalizedTerm = term?.trim() ?? ''
  return useQuery({
    queryKey: ['dictionary-entries', 'lookup', normalizedTerm.toLowerCase(), groupId],
    queryFn: () => window.dictol.entries.lookup(normalizedTerm, groupId),
    enabled: normalizedTerm.length > 0,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0
  })
}

export function useDictionarySearchGroups(): UseQueryResult<
  Awaited<ReturnType<Window['dictol']['entries']['listGroups']>>,
  Error
> {
  return useQuery({
    queryKey: ['dictionary-entries', 'search-groups'],
    queryFn: () => window.dictol.entries.listGroups(),
    staleTime: 30_000
  })
}
