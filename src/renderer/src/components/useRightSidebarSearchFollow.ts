import { useEffect, useRef } from 'react'

import { useAppStore } from '@/stores/app-store'

export function useRightSidebarSearchFollow(): void {
  const searchQuery = useAppStore((state) => state.searchQuery)
  const follow = useAppStore((state) => state.followRightSidebarSearch)
  const followTabs = useAppStore((state) => state.followSearchInRightSidebarTabs)
  const lastFollowedTerm = useRef(searchQuery.trim())

  useEffect(() => {
    const term = searchQuery.trim()
    if (!follow) {
      lastFollowedTerm.current = term
      return
    }
    if (!term || term === lastFollowedTerm.current) return

    const timeout = window.setTimeout(() => {
      lastFollowedTerm.current = term
      followTabs(term)
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [follow, followTabs, searchQuery])
}
