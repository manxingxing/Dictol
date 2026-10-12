import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import type {
  CustomCssEditorDictionary,
  CustomCssEditorSearchResult
} from '../../../shared/custom-css-editor'

export function useGetDictionary(
  dictionaryId: string | null
): UseQueryResult<CustomCssEditorDictionary, Error> {
  return useQuery({
    queryKey: ['custom-css-editor', 'dictionary', dictionaryId],
    queryFn: () => {
      if (!dictionaryId) throw new Error('缺少词典 ID')
      return window.dictolCustomCssEditor.getDictionary(dictionaryId)
    },
    enabled: dictionaryId !== null,
    networkMode: 'always',
    retry: false,
    staleTime: Infinity
  })
}

export function useSaveCss(dictionaryId: string): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: (css) => window.dictolCustomCssEditor.save(dictionaryId, css)
  })
}

export function useSearchEntry(
  dictionaryId: string
): UseMutationResult<CustomCssEditorSearchResult, Error, string> {
  return useMutation({
    mutationFn: (term) => window.dictolCustomCssEditor.searchEntry(dictionaryId, term)
  })
}
