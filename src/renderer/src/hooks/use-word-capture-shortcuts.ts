import { useMutation, type UseMutationResult } from '@tanstack/react-query'

type WordCaptureStatus = NonNullable<
  Awaited<ReturnType<typeof window.dictol.wordCapture.getStatus>>
>
type WordCaptureShortcutResult = NonNullable<
  Awaited<ReturnType<typeof window.dictol.wordCapture.setShortcut>>
>
type OcrShortcutVariables = { mode: 'dictionary' | 'ai'; shortcut: string }

export function useUpdateWordCaptureShortcut(
  onStatus: (status: WordCaptureStatus) => void
): UseMutationResult<WordCaptureShortcutResult, Error, string> {
  return useMutation({
    mutationFn: async (shortcut: string) => {
      const result = await window.dictol.wordCapture.setShortcut(shortcut)
      if (!result) throw new Error('无法更新快捷键设置。')
      return result
    },
    onSuccess: (result) => onStatus(result.status)
  })
}

export function useUpdateOcrShortcut(
  onStatus: (status: WordCaptureStatus) => void
): UseMutationResult<WordCaptureShortcutResult, Error, OcrShortcutVariables> {
  return useMutation({
    mutationFn: async ({ mode, shortcut }: OcrShortcutVariables) => {
      const result = await window.dictol.wordCapture.setOcrShortcut(mode, shortcut)
      if (!result) throw new Error('无法更新悬停取词快捷键。')
      return result
    },
    onSuccess: (result) => onStatus(result.status)
  })
}
