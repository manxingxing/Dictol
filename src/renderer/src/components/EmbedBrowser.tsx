import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Globe2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RightSidebarOnlineTab } from '@/stores/app-store'
import { useAppStore } from '@/stores/app-store'

export function EmbedBrowser({
  active,
  tab
}: {
  active: boolean
  tab: RightSidebarOnlineTab
}): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const loadedNavigationVersion = useRef<number | null>(null)
  const [address, setAddress] = useState(tab.currentUrl || tab.url)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const navigateOnlineDictionaryTab = useAppStore((state) => state.navigateOnlineDictionaryTab)
  const updateOnlineDictionaryTabUrl = useAppStore((state) => state.updateOnlineDictionaryTabUrl)

  useEffect(
    () =>
      window.dictol.embedBrowser.onUrlChanged((tabId, url) => {
        if (tabId !== tab.id) return
        setAddress(url)
        updateOnlineDictionaryTabUrl(tab.id, url)
      }),
    [tab.id, updateOnlineDictionaryTabUrl]
  )

  useEffect(
    () =>
      window.dictol.embedBrowser.onLoadingChanged((tabId, loading) => {
        if (tabId === tab.id) setIsLoading(loading)
      }),
    [tab.id]
  )

  useEffect(() => {
    // `navigationVersion` changes only for app-requested navigation; `currentUrl`
    // also changes on page redirects and should update the address without reload.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAddress(tab.currentUrl || tab.url)
    if (loadedNavigationVersion.current === tab.navigationVersion) return
    loadedNavigationVersion.current = tab.navigationVersion
    setError(null)
    setIsLoading(true)
    void window.dictol.embedBrowser
      .load(tab.id, tab.currentUrl || tab.url, tab.navigationVersion)
      .catch((loadError: unknown) => {
        console.error('Failed to load embedded online dictionary', { url: tab.url, loadError })
        setIsLoading(false)
        setError('网页加载失败，请检查网址后重试')
      })
  }, [tab.currentUrl, tab.id, tab.navigationVersion, tab.url])

  useLayoutEffect(() => {
    const container = contentRef.current
    if (!active || !container) return

    let animationFrame = 0
    const readBounds = (): { x: number; y: number; width: number; height: number } => {
      const bounds = container.getBoundingClientRect()
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      }
    }
    const updateBounds = (): void => {
      window.dictol.embedBrowser.setBounds(tab.id, readBounds())
    }
    const scheduleBoundsUpdate = (): void => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        updateBounds()
      })
    }
    window.dictol.embedBrowser.activate(tab.id, readBounds())
    const observer = new ResizeObserver(scheduleBoundsUpdate)
    observer.observe(container)
    scheduleBoundsUpdate()
    return () => {
      observer.disconnect()
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
    }
  }, [active, tab.id])

  const submitAddress = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const nextUrl = address.trim()
    if (!isHttpUrl(nextUrl)) {
      setError('请输入以 http:// 或 https:// 开头的网址')
      return
    }
    setError(null)
    navigateOnlineDictionaryTab(tab.id, nextUrl, tab.searchTerm)
  }

  return (
    <section
      aria-label={`${tab.title} 页面`}
      className="absolute inset-0 flex min-h-0 flex-col bg-[var(--panel-background)]"
      id={`right-sidebar-panel-${tab.id}`}
      role="tabpanel"
      style={{ display: active ? 'flex' : 'none' }}
    >
      <form
        className="relative flex h-10 shrink-0 items-center gap-2 border-b border-border px-2"
        onSubmit={submitAddress}
      >
        <Globe2 aria-hidden="true" className="ml-1 size-4 shrink-0 text-muted-foreground" />
        <Input
          aria-label="在线词典网址"
          className="h-8 min-w-0 flex-1 rounded-md px-2 text-xs"
          onChange={(event) => setAddress(event.target.value)}
          value={address}
        />
        <Button
          aria-label="打开网址"
          className="size-8 shrink-0"
          size="icon"
          title="打开网址"
          type="submit"
          variant="ghost"
        >
          <ArrowRight className="size-3.5" />
        </Button>
        {isLoading && (
          <div
            aria-label="网页正在加载"
            className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
            role="progressbar"
          >
            <div className="native-view-loading-indicator h-full bg-primary" />
          </div>
        )}
      </form>
      {error && (
        <p className="shrink-0 px-3 py-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div aria-label="在线词典内容" className="min-h-0 flex-1" ref={contentRef} />
    </section>
  )
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
