import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { toast } from 'sonner'

export function useOpenTranslationLanguageSettings(): UseMutationResult<void, Error, void> {
  return useMutation({
    mutationFn: () => window.dictol.translation.openLanguageSettings(),
    onError: () => toast.error('无法打开系统设置，请按下方路径手动前往。')
  })
}
