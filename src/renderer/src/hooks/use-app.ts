import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'

export const resourceCacheSizeQueryKey = ['app', 'resource-cache-size'] as const
export const viewCacheSizeQueryKey = ['app', 'view-cache-size'] as const

/**
 * 缓存占用会随后台解压、页面访问随时变化，因此这些查询完全禁用缓存：
 * 每次挂载都重新查询，卸载后立即丢弃结果。
 */
const uncachedQueryOptions = {
  gcTime: 0,
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always'
} as const

/** 从 MDD 解压出来的本地资源缓存占用空间。 */
export function useResourceCacheSize(): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: resourceCacheSizeQueryKey,
    queryFn: () => window.dictol.app.getResourceCacheSize(),
    ...uncachedQueryOptions
  })
}

export function useClearResourceCache(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => window.dictol.app.clearResourceCache(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: resourceCacheSizeQueryKey })
    }
  })
}

/** 查词释义视图与内置浏览器分区占用的页面缓存空间。 */
export function useViewCacheSize(): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: viewCacheSizeQueryKey,
    queryFn: () => window.dictol.app.getViewCacheSize(),
    ...uncachedQueryOptions
  })
}

export function useClearViewCache(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => window.dictol.app.clearViewCache(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viewCacheSizeQueryKey })
    }
  })
}
