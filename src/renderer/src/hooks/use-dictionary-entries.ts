import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'

export type DictionarySearchResult = Awaited<
  ReturnType<Window['dictol']['entries']['search']>
>[number]
export type DictionaryEntryGroup = Awaited<ReturnType<Window['dictol']['entries']['lookup']>>

export function useDictionarySearch(
  prefix: string,
  limit = 50
): UseQueryResult<DictionarySearchResult[], Error> {
  const normalizedPrefix = prefix.trim()
  return useQuery({
    queryKey: ['dictionary-entries', 'prefix', normalizedPrefix.toLowerCase(), limit],
    queryFn: () => window.dictol.entries.search(normalizedPrefix, limit),
    enabled: normalizedPrefix.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0
  })
}

export function useDictionaryLookup(
  term: string | undefined
): UseQueryResult<DictionaryEntryGroup, Error> {
  const normalizedTerm = term?.trim() ?? ''
  return useQuery({
    queryKey: ['dictionary-entries', 'lookup', normalizedTerm.toLowerCase()],
    queryFn: () => window.dictol.entries.lookup(normalizedTerm),
    enabled: normalizedTerm.length > 0,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0
  })
}
