import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'

import type {
  TtsConfig,
  TtsCredentialsStatus,
  TtsSaveSettingsRequest,
  TtsVoice
} from '../../../shared/tts'

const ttsConfigQueryKey = ['tts', 'config'] as const
const systemTtsVoicesQueryKey = ['tts', 'system-voices'] as const
const credentialsQueryKey = ['tts', 'credentials'] as const

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

export function useTtsCredentialsStatus(): UseQueryResult<TtsCredentialsStatus, Error> {
  return useQuery({
    queryKey: credentialsQueryKey,
    queryFn: async () => {
      const result = await window.dictol.tts.getCredentialsStatus()
      if (!result) throw new Error('无法读取语音服务凭据状态。')
      return result
    }
  })
}

export function useSaveTtsConfig(): UseMutationResult<TtsConfig, Error, TtsConfig> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (config) => {
      const result = await window.dictol.tts.saveConfig(config)
      if (!result) throw new Error('保存朗读设置失败。')
      return result
    },
    onSuccess: (config) => queryClient.setQueryData(ttsConfigQueryKey, config)
  })
}

export function useSaveTtsSettings(): UseMutationResult<TtsConfig, Error, TtsSaveSettingsRequest> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (request) => {
      const result = await window.dictol.tts.saveSettings(request)
      if (!result) throw new Error('保存朗读设置失败。')
      return result
    },
    onSuccess: (config) => {
      queryClient.setQueryData(ttsConfigQueryKey, config)
      void queryClient.invalidateQueries({ queryKey: credentialsQueryKey })
    }
  })
}
