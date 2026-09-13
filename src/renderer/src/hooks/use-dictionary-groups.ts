import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'

export const dictionaryGroupsQueryKey = ['dictionary-groups'] as const

export type DictionaryGroup = Awaited<
  ReturnType<Window['dictol']['dictionaries']['groups']['list']>
>[number]

export function useDictionaryGroups(): UseQueryResult<DictionaryGroup[], Error> {
  return useQuery({
    queryKey: dictionaryGroupsQueryKey,
    queryFn: () => window.dictol.dictionaries.groups.list(),
    staleTime: 30_000
  })
}

export function useCreateDictionaryGroup(): UseMutationResult<DictionaryGroup, Error, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name) => window.dictol.dictionaries.groups.create(name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dictionaryGroupsQueryKey })
      await queryClient.invalidateQueries({ queryKey: ['dictionary-entries'] })
    }
  })
}

export function useRenameDictionaryGroup(): UseMutationResult<
  void,
  Error,
  { groupId: string; name: string }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, name }) => window.dictol.dictionaries.groups.updateName(groupId, name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dictionaryGroupsQueryKey })
      await queryClient.invalidateQueries({ queryKey: ['dictionary-entries'] })
    }
  })
}

export function useDeleteDictionaryGroup(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (groupId) => window.dictol.dictionaries.groups.delete(groupId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dictionaryGroupsQueryKey })
      await queryClient.invalidateQueries({ queryKey: ['dictionary-entries'] })
    }
  })
}

export function useUpdateDictionaryGroupMembers(): UseMutationResult<
  void,
  Error,
  { groupId: string; dictionaryIds: string[] }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, dictionaryIds }) =>
      window.dictol.dictionaries.groups.updateMembers(groupId, dictionaryIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dictionaryGroupsQueryKey })
      await queryClient.invalidateQueries({ queryKey: ['dictionary-entries'] })
    }
  })
}
