import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'

type KeyboardShortcutStatus = NonNullable<
  Awaited<ReturnType<typeof window.dictol.keyboard.getStatus>>
>
type KeyboardShortcutResult = NonNullable<
  Awaited<ReturnType<typeof window.dictol.keyboard.setMainWindowShortcut>>
>

export const keyboardShortcutStatusQueryKey = ['keyboard', 'shortcut-status'] as const

export function useKeyboardShortcutStatus(): UseQueryResult<KeyboardShortcutStatus, Error> {
  return useQuery({
    queryKey: keyboardShortcutStatusQueryKey,
    queryFn: async () => {
      const status = await window.dictol.keyboard.getStatus()
      if (!status) throw new Error('无法读取快捷键设置。')
      return status
    },
    refetchOnWindowFocus: true,
    retry: false
  })
}

export function useUpdateMainWindowShortcut(): UseMutationResult<
  KeyboardShortcutResult,
  Error,
  string
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (shortcut: string) => {
      const result = await window.dictol.keyboard.setMainWindowShortcut(shortcut)
      if (!result) throw new Error('无法更新快捷键设置。')
      return result
    },
    onSuccess: (result) => queryClient.setQueryData(keyboardShortcutStatusQueryKey, result.status)
  })
}
