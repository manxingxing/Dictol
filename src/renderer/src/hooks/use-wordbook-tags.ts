import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'

export const wordbookTagsQueryKey = ['wordbooks', 'tags'] as const

export type WordbookTag = Awaited<ReturnType<Window['dictol']['wordbooks']['listTags']>>[number]

export function useWordbookTags(): UseQueryResult<WordbookTag[], Error> {
  return useQuery({
    queryKey: wordbookTagsQueryKey,
    queryFn: () => window.dictol.wordbooks.listTags()
  })
}

function useInvalidateWordbookTagData(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: wordbookTagsQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['wordbooks', 'words'] })
    ])
  }
}

export function useCreateWordbookTag(): UseMutationResult<
  Awaited<ReturnType<Window['dictol']['wordbooks']['createTag']>>,
  Error,
  string
> {
  const invalidate = useInvalidateWordbookTagData()
  return useMutation({
    mutationFn: (term) => window.dictol.wordbooks.createTag(term),
    onSuccess: invalidate
  })
}

export function useRenameWordbookTag(): UseMutationResult<
  void,
  Error,
  { tagId: string; name: string }
> {
  const invalidate = useInvalidateWordbookTagData()
  return useMutation({
    mutationFn: ({ tagId, name }) => window.dictol.wordbooks.renameTag(tagId, name),
    onSuccess: invalidate
  })
}

export function useDeleteWordbookTag(): UseMutationResult<void, Error, string> {
  const invalidate = useInvalidateWordbookTagData()
  return useMutation({
    mutationFn: (tagId) => window.dictol.wordbooks.deleteTag(tagId),
    onSuccess: invalidate
  })
}

export function useSetWordTags(): UseMutationResult<
  void,
  Error,
  { wordId: string; tagIds: string[] }
> {
  const invalidate = useInvalidateWordbookTagData()
  return useMutation({
    mutationFn: ({ wordId, tagIds }) => window.dictol.wordbooks.setWordTags(wordId, tagIds),
    onSuccess: invalidate
  })
}

export function useAddTagToWords(): UseMutationResult<
  void,
  Error,
  { wordIds: string[]; tagId: string }
> {
  const invalidate = useInvalidateWordbookTagData()
  return useMutation({
    mutationFn: ({ wordIds, tagId }) => window.dictol.wordbooks.addTagToWords(wordIds, tagId),
    onSuccess: invalidate
  })
}

export function useRemoveTagFromWords(): UseMutationResult<
  void,
  Error,
  { wordIds: string[]; tagId: string }
> {
  const invalidate = useInvalidateWordbookTagData()
  return useMutation({
    mutationFn: ({ wordIds, tagId }) => window.dictol.wordbooks.removeTagFromWords(wordIds, tagId),
    onSuccess: invalidate
  })
}
