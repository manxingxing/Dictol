import { memo, useCallback, useEffect, useLayoutEffect } from 'react'
import { Globe2, Link, Sparkles, Unlink, X } from 'lucide-react'

import { AiLookupTab } from '@/components/AiLookupSidebar'
import { EmbedBrowser } from '@/components/EmbedBrowser'
import { RightSidebarSizeToggle } from '@/components/RightSidebarSizeToggle'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import type { RightSidebarTab } from '@/stores/app-store'
import { useAppStore } from '@/stores/app-store'

export const RightSidebar = memo(function RightSidebar(): React.JSX.Element {
  const tabs = useAppStore((state) => state.rightSidebarTabs)
  const activeTabId = useAppStore((state) => state.activeRightSidebarTabId)
  const followSearch = useAppStore((state) => state.followRightSidebarSearch)
  const sidebarOpen = useAppStore((state) => state.rightSidebarOpen)
  const activateTab = useAppStore((state) => state.activateRightSidebarTab)
  const closeTab = useAppStore((state) => state.closeRightSidebarTab)
  const setFollowSearch = useAppStore((state) => state.setFollowRightSidebarSearch)
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen)
  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  useLayoutEffect(() => {
    if (!sidebarOpen || activeTab?.kind !== 'online') {
      window.dictol.embedBrowser.activate(null)
    }
  }, [activeTab?.id, activeTab?.kind, sidebarOpen])

  useEffect(() => () => window.dictol.embedBrowser.activate(null), [])

  const handleCloseTab = useCallback(
    async (tab: RightSidebarTab): Promise<void> => {
      if (tab.kind === 'online') {
        try {
          await window.dictol.embedBrowser.close(tab.id)
        } catch (error) {
          console.error('Failed to close online dictionary tab', { tabId: tab.id, error })
          return
        }
      }
      closeTab(tab.id)
    },
    [closeTab]
  )

  return (
    <aside aria-label="右侧工作区" className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2">
        <ScrollArea
          className="h-full min-w-0 flex-1"
          horizontalWheel
          showVerticalScrollbar={false}
          viewportClassName="[&>div]:h-full"
        >
          <div
            aria-label="在线词典与 AI 会话"
            className="flex h-full w-max min-w-full items-center gap-1"
            role="tablist"
          >
            {tabs.map((tab) => {
              const active = sidebarOpen && tab.id === activeTabId
              return (
                <div
                  className={`flex h-8 min-w-0 shrink-0 items-center rounded-full border transition-colors ${
                    active
                      ? 'max-w-48 border-primary/30 bg-primary/10 text-primary'
                      : 'group size-8 justify-center border-transparent text-muted-foreground hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-foreground'
                  }`}
                  key={tab.id}
                >
                  <button
                    aria-controls={`right-sidebar-panel-${tab.id}`}
                    aria-selected={active}
                    className={`flex h-full min-w-0 items-center gap-1.5 rounded-full ${active ? 'pl-2 pr-1' : 'w-full justify-center'}`}
                    id={`right-sidebar-tab-${tab.id}`}
                    onClick={() => activateTab(tab.id)}
                    role="tab"
                    title={tab.kind === 'online' ? tab.title : `AI 对话：${tab.title}`}
                    type="button"
                  >
                    <RightSidebarTabIcon tab={tab} />
                    {active && <span className="min-w-0 truncate text-xs">{tab.title}</span>}
                  </button>
                  {active && (
                    <Button
                      aria-label={`关闭${tab.kind === 'online' ? `${tab.title}词典` : `AI 对话 ${tab.title}`}`}
                      className="mr-1 size-5 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      onClick={() => void handleCloseTab(tab)}
                      size="icon"
                      title="关闭标签页"
                      type="button"
                      variant="ghost"
                    >
                      <X className="size-3" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <ScrollBar className="h-0 border-0 p-0" orientation="horizontal" />
        </ScrollArea>
        <div aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
        <div className="flex shrink-0 items-center">
          <Button
            aria-label={followSearch ? '关闭跟随查询' : '跟随查询'}
            aria-pressed={followSearch}
            className={`mr-1 size-7 shrink-0 ${followSearch ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''}`}
            onClick={() => setFollowSearch(!followSearch)}
            size="icon"
            title={followSearch ? '关闭跟随查询' : '跟随查询'}
            type="button"
            variant="ghost"
          >
            {followSearch ? <Link /> : <Unlink />}
          </Button>
          <RightSidebarSizeToggle />
          <Button
            aria-label="关闭右侧栏"
            className="size-7 shrink-0"
            onClick={(event) => {
              event.stopPropagation()
              setRightSidebarOpen(false)
            }}
            size="icon"
            title="关闭右侧栏"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--panel-background)]">
        {tabs.map((tab) => {
          const active = sidebarOpen && tab.id === activeTabId
          return tab.kind === 'ai' ? (
            <AiLookupTab active={active} key={tab.id} tab={tab} />
          ) : (
            <EmbedBrowser active={active} key={tab.id} tab={tab} />
          )
        })}
        {tabs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm leading-6 text-muted-foreground">
            <Globe2 aria-hidden="true" className="mb-2 size-5" />
            <strong className="font-medium text-foreground">工作区已清空</strong>
            <p>点击释义区的在线词典图标或 Sparkle，打开一个标签页。</p>
          </div>
        )}
      </div>
    </aside>
  )
})

function RightSidebarTabIcon({ tab }: { tab: RightSidebarTab }): React.JSX.Element {
  if (tab.kind === 'ai') {
    return (
      <Sparkles
        aria-hidden="true"
        className="size-3.5 shrink-0 transition-colors group-hover:text-[var(--fg-accent)]"
      />
    )
  }
  return (
    <span className="relative size-4 shrink-0 overflow-hidden rounded-full bg-background transition-colors group-hover:bg-[var(--surface-selected)]">
      <img
        alt=""
        className="size-full object-cover"
        onError={(event) => {
          event.currentTarget.style.display = 'none'
          event.currentTarget.nextElementSibling?.classList.remove('hidden')
        }}
        src={tab.faviconUrl}
      />
      <Globe2
        aria-hidden="true"
        className="absolute inset-0 m-auto hidden size-3 text-muted-foreground transition-colors group-hover:text-[var(--fg-accent)]"
      />
    </span>
  )
}
