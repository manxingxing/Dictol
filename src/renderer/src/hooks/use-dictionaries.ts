import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import type { DictionaryInfo } from '../../../shared/dictionary-info'

export const readyDictionariesQueryKey = ['dictionaries', 'ready'] as const
export const dictionariesQueryKey = ['dictionaries', 'all'] as const
export const dictionaryInfoQueryKey = (dictionaryId: string | null) =>
  ['dictionary-info', dictionaryId] as const

type DictionarySummary = Awaited<ReturnType<Window['dictol']['dictionaries']['list']>>[number]
type ReadyDictionary = Awaited<ReturnType<Window['dictol']['dictionaries']['listReady']>>[number]
type ImportedDictionary = Awaited<ReturnType<Window['dictol']['dictionaries']['import']>>
type DictionaryImportRequest = Parameters<Window['dictol']['dictionaries']['import']>[0]
type ReorderDictionariesContext = { previousDictionaries?: DictionarySummary[] }

export function useDictionaryInfo(
  dictionaryId: string | null
): UseQueryResult<DictionaryInfo, Error> {
  return useQuery({
    queryKey: dictionaryInfoQueryKey(dictionaryId),
    queryFn: () => {
      if (!dictionaryId) throw new Error('Dictionary id is required')
      return window.dictol.dictionaries.getInfo(dictionaryId)
    },
    enabled: dictionaryId !== null,
    staleTime: 5 * 60_000
  })
}

export function useDictionaries(): UseQueryResult<DictionarySummary[], Error> {
  return useQuery({
    queryKey: dictionariesQueryKey,
    queryFn: () => window.dictol.dictionaries.list(),
    refetchInterval: 2_000
  })
}

export function useReadyDictionaries(): UseQueryResult<ReadyDictionary[], Error> {
  return useQuery({
    queryKey: readyDictionariesQueryKey,
    queryFn: async () => {
      const dictionaries = await window.dictol.dictionaries.listReady()
      return dictionaries
    },
    staleTime: 30_000
  })
}

export function useImportDictionary(): UseMutationResult<
  ImportedDictionary,
  Error,
  DictionaryImportRequest
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request) => window.dictol.dictionaries.import(request),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dictionariesQueryKey }),
        queryClient.invalidateQueries({ queryKey: readyDictionariesQueryKey })
      ])
    }
  })
}

export function useDeleteDictionary(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (dictionaryId) => window.dictol.dictionaries.delete(dictionaryId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionaries'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-entries'] })
      ])
    }
  })
}

export function useReorderDictionaries(): UseMutationResult<
  void,
  Error,
  string[],
  ReorderDictionariesContext
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (dictionaryIds) => window.dictol.dictionaries.reorder(dictionaryIds),
    onMutate: async (dictionaryIds) => {
      await queryClient.cancelQueries({ queryKey: dictionariesQueryKey })
      const previousDictionaries =
        queryClient.getQueryData<DictionarySummary[]>(dictionariesQueryKey)
      if (previousDictionaries) {
        const byId = new Map(previousDictionaries.map((dictionary) => [dictionary.id, dictionary]))
        queryClient.setQueryData(
          dictionariesQueryKey,
          dictionaryIds.map((id) => byId.get(id)).filter((item) => item !== undefined)
        )
      }
      return { previousDictionaries }
    },
    onError: (_error, _dictionaryIds, context) => {
      if (context?.previousDictionaries) {
        queryClient.setQueryData(dictionariesQueryKey, context.previousDictionaries)
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionaries'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-entries'] })
      ])
    }
  })
}

export function useUpdateDictionaryName(): UseMutationResult<
  void,
  Error,
  { dictionaryId: string; name: string }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ dictionaryId, name }) =>
      window.dictol.dictionaries.updateName(dictionaryId, name),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dictionaries'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-entries'] })
      ])
    }
  })
}

export function useUpdateDictionaryEnabled(): UseMutationResult<
  void,
  Error,
  { dictionaryId: string; enabled: boolean }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ dictionaryId, enabled }) =>
      window.dictol.dictionaries.updateEnabled(dictionaryId, enabled),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dictionariesQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['dictionaries', 'ready'] }),
        queryClient.invalidateQueries({ queryKey: ['dictionary-entries'] })
      ])
    }
  })
}

export function useUpdateDictionaryCustomCss(): UseMutationResult<
  void,
  Error,
  { dictionaryId: string; customCss: string }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ dictionaryId, customCss }) =>
      window.dictol.dictionaries.updateCustomCss(dictionaryId, customCss),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dictionariesQueryKey })
    }
  })
}
