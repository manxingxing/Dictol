import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'

import type {
  ScreenshotTranslationSettingResult,
  ScreenshotTranslationStatus,
  SelectionTranslationShortcutResult,
  SelectionTranslationShortcutStatus
} from '../../../shared/translation'

export const screenshotStatusQueryKey = ['translation', 'screenshot-status'] as const
export const selectionShortcutStatusQueryKey = ['translation', 'selection-shortcut-status'] as const

// 截图翻译
export function useScreenshotTranslationStatus(): UseQueryResult<
  ScreenshotTranslationStatus,
  Error
> {
  return useQuery({
    queryKey: screenshotStatusQueryKey,
    queryFn: async () => {
      const status = await window.dictol.translation.getScreenshotStatus()
      if (!status) throw new Error('无法读取截图翻译设置。')
      return status
    },
    refetchOnWindowFocus: true,
    retry: false
  })
}

export function useUpdateScreenshotShortcut(): UseMutationResult<
  ScreenshotTranslationSettingResult,
  Error,
  string
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (shortcut: string) => {
      const result = await window.dictol.translation.setScreenshotShortcut(shortcut)
      if (!result) throw new Error('无法保存截图翻译设置。')
      return result
    },
    onSuccess: (result) => {
      if (result.ok) queryClient.setQueryData(screenshotStatusQueryKey, result.status)
    }
  })
}

// 划词翻译
export function useSelectionTranslationShortcutStatus(): UseQueryResult<
  SelectionTranslationShortcutStatus,
  Error
> {
  return useQuery({
    queryKey: selectionShortcutStatusQueryKey,
    queryFn: async () => {
      const status = await window.dictol.translation.getSelectionShortcutStatus()
      if (!status) throw new Error('无法读取选区翻译快捷键设置。')
      return status
    },
    refetchOnWindowFocus: true,
    retry: false
  })
}

export function useUpdateSelectionTranslationShortcut(): UseMutationResult<
  SelectionTranslationShortcutResult,
  Error,
  string
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (shortcut: string) => {
      const result = await window.dictol.translation.setSelectionShortcut(shortcut)
      if (!result) throw new Error('无法保存选区翻译快捷键设置。')
      return result
    },
    onSuccess: (result) => {
      if (result.ok) queryClient.setQueryData(selectionShortcutStatusQueryKey, result.status)
    }
  })
}
