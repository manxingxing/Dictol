import type { ReactNode } from 'react'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

export function SearchResultToolbar({
  children,
  actions,
  loading
}: {
  children?: ReactNode
  actions: ReactNode
  loading: boolean
}): React.JSX.Element {
  return (
    <div className="relative flex h-14 shrink-0 items-center overflow-visible border-b border-border bg-[var(--dictionary-toolbar-background)] px-3">
      {children ? (
        <ScrollArea
          className="h-full min-w-0 flex-1 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-3 after:bg-linear-to-r after:from-transparent after:to-[var(--dictionary-toolbar-background)] after:content-['']"
          showVerticalScrollbar={false}
          viewportClassName="[&>div]:h-full"
        >
          {children}
          <ScrollBar orientation="horizontal" />
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
  )
}
