import { useLayoutEffect } from 'react'

export function useMainWindowChrome(): void {
  useLayoutEffect(() => {
    const root = document.documentElement
    let active = true
    if (window.dictol.mainWindowChromeMaterial) {
      root.dataset.chromeMaterial = window.dictol.mainWindowChromeMaterial
    } else {
      delete root.dataset.chromeMaterial
    }

    let receivedFocusEvent = false
    const unsubscribe = window.dictol.app.onMainWindowFocusChanged((isFocused) => {
      receivedFocusEvent = true
      root.dataset.windowActive = String(isFocused)
    })

    void window.dictol.app.isMainWindowFocused().then((isFocused) => {
      if (active && !receivedFocusEvent) root.dataset.windowActive = String(isFocused)
    })

    return () => {
      active = false
      unsubscribe()
      delete root.dataset.windowActive
      delete root.dataset.chromeMaterial
    }
  }, [])
}
