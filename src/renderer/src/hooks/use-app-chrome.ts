import { useEffect, useLayoutEffect } from 'react'

import { APP_PREFERENCES_STORAGE_KEY, useAppStore } from '@/stores/app-store'

export function useAppChrome(): void {
  const chromeTone = useAppStore((state) => state.chromeTone)

  useLayoutEffect(() => {
    document.documentElement.dataset.chromeTone = chromeTone
    const updateWindowActivity = (): void => {
      document.documentElement.dataset.windowActive = String(document.hasFocus())
    }

    updateWindowActivity()
    window.addEventListener('focus', updateWindowActivity)
    window.addEventListener('blur', updateWindowActivity)

    if (window.dictol?.platform === 'darwin') {
      document.documentElement.dataset.chromeVibrancy = 'on'
    } else {
      delete document.documentElement.dataset.chromeVibrancy
    }

    return () => {
      window.removeEventListener('focus', updateWindowActivity)
      window.removeEventListener('blur', updateWindowActivity)
    }
  }, [chromeTone])

  useEffect(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== APP_PREFERENCES_STORAGE_KEY) return
      void useAppStore.persist.rehydrate()
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])
}
