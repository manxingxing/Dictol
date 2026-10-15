import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { useEffect } from 'react'
import type {
  DictionaryNoteItem,
  DictionaryNoteSearchResult,
  DictionaryNoteWordGroupSearchResult
} from '../../../shared/dictionary-note'

export type DictionaryNote = DictionaryNoteItem
export type DictionaryNoteContent = Parameters<
  Window['dictol']['dictionaryNotes']['updateContent']
>[1]
type CreateDictionaryNoteInput = {
  comment: string | null
  commentRich: string | null
  images: File[]
}

export const dictionaryNotesQueryKey = (term: string) =>
  ['dictionary-notes', 'term', term.toLocaleLowerCase()] as const
export const dictionaryNoteCountQueryKey = (term: string) =>
  ['dictionary-note-count', term.toLocaleLowerCase()] as const

export function useDictionaryNoteCreationResult(
  onSuccess?: (relatedTerms: string[]) => void,
  onFail?: (relatedTerms: string[], message: string) => void
): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    return window.dictol.dictionaryNotes.onCreationResult((result) => {
      if (result.status === 'success') {
        void queryClient.invalidateQueries({ queryKey: ['dictionary-notes'] })
        void queryClient.invalidateQueries({ queryKey: ['dictionary-note-count'] })
        onSuccess?.(result.relatedTerms)
      } else {
        onFail?.(result.relatedTerms, result.message)
      }
    })
  }, [onSuccess, onFail, queryClient])
}

export function useDictionaryNotes(
  term: string,
  active: boolean
): UseQueryResult<DictionaryNote[], Error> {
  return useQuery({
    queryKey: dictionaryNotesQueryKey(term),
    queryFn: () => window.dictol.dictionaryNotes.listByTerm(term),
    enabled: active && term.trim().length > 0,
    refetchOnWindowFocus: false
  })
}

export function useDictionaryNoteCount(term: string): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: dictionaryNoteCountQueryKey(term),
    queryFn: () => window.dictol.dictionaryNotes.countByTerm(term),
    enabled: term.trim().length > 0
  })
}

export function useSearchDictionaryNotes(
  query: string,
  page: number,
  pageSize: number,
  enabled: boolean
): UseQueryResult<DictionaryNoteSearchResult, Error> {
  return useQuery({
    queryKey: ['dictionary-notes', 'search', query, page, pageSize],
    queryFn: () => window.dictol.dictionaryNotes.search(query, page, pageSize),
    enabled
  })
}

export function useSearchDictionaryNotesByWord(
  query: string,
  page: number,
  pageSize: number,
  enabled: boolean
): UseQueryResult<DictionaryNoteWordGroupSearchResult, Error> {
  return useQuery({
    queryKey: ['dictionary-notes', 'search-by-word', query, page, pageSize],
    queryFn: () => window.dictol.dictionaryNotes.searchByWord(query, page, pageSize),
    enabled
  })
}

export function useCreateDictionaryNote(
  term: string
): UseMutationResult<DictionaryNote, Error, CreateDictionaryNoteInput> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ comment, commentRich, images }) =>
      window.dictol.dictionaryNotes.create({
        relatedTerms: [term],
        comment,
        commentRich,
        imageBytes: await Promise.all(
          images.map(async (image) => new Uint8Array(await image.arrayBuffer()))
        )
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dictionaryNotesQueryKey(term) })
      await queryClient.invalidateQueries({ queryKey: dictionaryNoteCountQueryKey(term) })
    }
  })
}

export function useDeleteNoteForTerm(term: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noteId) => window.dictol.dictionaryNotes.delete(noteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dictionaryNotesQueryKey(term) })
      await queryClient.invalidateQueries({ queryKey: dictionaryNoteCountQueryKey(term) })
    }
  })
}

export function useUpdateNoteContentForTerm(
  term: string
): UseMutationResult<void, Error, { noteId: string; content: DictionaryNoteContent }> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, content }) =>
      window.dictol.dictionaryNotes.updateContent(noteId, content),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dictionaryNotesQueryKey(term) })
    }
  })
}

export function useDeleteNote(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noteId) => window.dictol.dictionaryNotes.delete(noteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dictionary-notes'] })
      await queryClient.invalidateQueries({ queryKey: ['dictionary-note-count'] })
    }
  })
}

export function useUpdateNoteContent(
  onSaved: () => void
): UseMutationResult<void, Error, { noteId: string; content: DictionaryNoteContent }> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, content }) =>
      window.dictol.dictionaryNotes.updateContent(noteId, content),
    onSuccess: async () => {
      onSaved()
      await queryClient.invalidateQueries({ queryKey: ['dictionary-notes'] })
    }
  })
}
