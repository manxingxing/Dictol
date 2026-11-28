import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult
} from '@tanstack/react-query'
import type { OcrConfig } from '../../../shared/ocr-settings'

const ocrConfigQueryKey = ['ocr', 'config'] as const

export function useOcrConfig(): UseQueryResult<OcrConfig, Error> {
  return useQuery({
    queryKey: ocrConfigQueryKey,
    queryFn: async () => {
      const config = await window.dictol.ocr.getConfig()
      if (!config) throw new Error('无法读取 OCR 设置。')
      return config
    }
  })
}

export function useSaveOcrConfig(): UseMutationResult<OcrConfig, Error, OcrConfig> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (config: OcrConfig) => {
      const saved = await window.dictol.ocr.saveConfig(config)
      if (!saved) throw new Error('无法保存 OCR 设置。')
      return saved
    },
    onSuccess: (config) => queryClient.setQueryData(ocrConfigQueryKey, config)
  })
}
