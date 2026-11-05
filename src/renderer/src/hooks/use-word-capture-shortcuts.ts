import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'

type WordCaptureStatus = NonNullable<
  Awaited<ReturnType<typeof window.dictol.wordCapture.getStatus>>
>
type WordCaptureShortcutResult = NonNullable<
  Awaited<ReturnType<typeof window.dictol.wordCapture.setShortcut>>
>
type OcrShortcutVariables = { mode: 'dictionary' | 'ai'; shortcut: string }

export const wordCaptureStatusQueryKey = ['word-capture', 'status'] as const

export function useWordCaptureStatus(): UseQueryResult<WordCaptureStatus, Error> {
  return useQuery({
    queryKey: wordCaptureStatusQueryKey,
    queryFn: async () => {
      const status = await window.dictol.wordCapture.getStatus()
      if (!status) throw new Error('无法读取取词状态。')
      return status
    },
    refetchOnWindowFocus: true,
    retry: false
  })
}

export function useUpdateWordCaptureShortcut(): UseMutationResult<
  WordCaptureShortcutResult,
  Error,
  string
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (shortcut: string) => {
      const result = await window.dictol.wordCapture.setShortcut(shortcut)
      if (!result) throw new Error('无法更新快捷键设置。')
      return result
    },
    onSuccess: (result) => queryClient.setQueryData(wordCaptureStatusQueryKey, result.status)
  })
}

export function useUpdateOcrShortcut(): UseMutationResult<
  WordCaptureShortcutResult,
  Error,
  OcrShortcutVariables
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ mode, shortcut }: OcrShortcutVariables) => {
      const result = await window.dictol.wordCapture.setOcrShortcut(mode, shortcut)
      if (!result) throw new Error('无法更新悬停取词快捷键。')
      return result
    },
    onSuccess: (result) => queryClient.setQueryData(wordCaptureStatusQueryKey, result.status)
  })
}
