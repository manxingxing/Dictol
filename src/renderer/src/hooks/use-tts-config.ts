import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'

import type { TtsConfig, TtsVoice } from '../../../shared/tts'

const ttsConfigQueryKey = ['tts', 'config'] as const
const systemTtsVoicesQueryKey = ['tts', 'system-voices'] as const

export function useTtsConfig(): UseQueryResult<TtsConfig, Error> {
  return useQuery({
    queryKey: ttsConfigQueryKey,
    queryFn: async () => {
      const config = await window.dictol.tts.getConfig()
      if (!config) throw new Error('无法读取朗读设置。')
      return config
    }
  })
}

export function useSystemTtsVoices(): UseQueryResult<TtsVoice[], Error> {
  const queryClient = useQueryClient()

  useEffect(() => {
    const refreshVoices = (): void => {
      queryClient.setQueryData(systemTtsVoicesQueryKey, window.dictol.tts.getVoices())
    }
    const unsubscribe = window.dictol.tts.onVoicesChanged(refreshVoices)
    refreshVoices()
    return unsubscribe
  }, [queryClient])

  return useQuery({
    queryKey: systemTtsVoicesQueryKey,
    queryFn: () => window.dictol.tts.getVoices()
  })
}

export function useSaveTtsVoice(): UseMutationResult<TtsConfig, Error, string | null> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (systemVoiceUri: string | null) => {
      const config = queryClient.getQueryData<TtsConfig>(ttsConfigQueryKey)
      if (!config) throw new Error('无法读取朗读设置。')
      const saved = await window.dictol.tts.saveConfig({ ...config, systemVoiceUri })
      if (!saved) throw new Error('保存朗读设置失败。')
      return saved
    },
    onSuccess: (config) => queryClient.setQueryData(ttsConfigQueryKey, config)
  })
}
