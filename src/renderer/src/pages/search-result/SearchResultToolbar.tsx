import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { TooltipProvider } from '@/components/ui/tooltip'

export function SearchResultToolbar({
  children,
  actions,
  loading
}: {
  children?: ReactNode
  actions: ReactNode
  loading: boolean
}): React.JSX.Element {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const navigationRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current!
    const navigation = navigationRef.current
    const dock = toolbar.querySelector<HTMLElement>('.search-action-dock')
    const online = dock?.querySelector<HTMLElement>('.online-dictionary-collapse')
    const options = online?.querySelector<HTMLElement>('.online-dictionary-options')
    if (!dock || !online || !options) {
      delete toolbar.dataset.actionsCollapsed
      return
    }

    const measure = (): void => {
      const style = getComputedStyle(toolbar)
      const available =
        toolbar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      // Computed width ignores hover transforms. Subtract the current online slot so
      // collapsing or temporarily expanding it cannot change the fit decision.
      const expandedOnlineWidth = parseFloat(getComputedStyle(options).width)
      const expandedDockWidth =
        dock.getBoundingClientRect().width -
        online.getBoundingClientRect().width +
        expandedOnlineWidth
      const navigationWidth = navigation?.getBoundingClientRect().width ?? 0
      toolbar.dataset.actionsCollapsed = String(navigationWidth + expandedDockWidth > available)
      online.style.setProperty('--online-dictionary-expanded-width', `${expandedOnlineWidth}px`)
    }

    measure()
    const observer = new ResizeObserver(measure)
    for (const element of [toolbar, navigation, dock, online, options]) {
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [children, actions])

  return (
    <TooltipProvider>
      <div
        ref={toolbarRef}
        className="relative flex h-14 shrink-0 items-center overflow-visible border-b border-border bg-[var(--dictionary-toolbar-background)] px-3"
      >
        {children ? (
          <ScrollArea
            horizontalWheel
            className="h-full min-w-0 flex-1 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-3 after:bg-linear-to-r after:from-transparent after:to-[var(--dictionary-toolbar-background)] after:content-['']"
            showVerticalScrollbar={false}
            viewportClassName="[&>div]:h-full"
          >
            <div ref={navigationRef} className="flex h-full w-max items-center">
              {children}
            </div>
            <ScrollBar orientation="horizontal" className="h-0" />
          </ScrollArea>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {actions}
        {loading && (
          <div
            aria-label="词条内容正在加载"
            className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-0.5 overflow-hidden"
            role="progressbar"
          >
            <div className="native-view-loading-indicator h-full bg-primary" />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
