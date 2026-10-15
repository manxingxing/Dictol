import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { usePanelCallbackRef } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'

import {
  RIGHT_SIDEBAR_DEFAULT_SIZE,
  RIGHT_SIDEBAR_MAX_SIZE,
  selectCompactMode,
  useAppStore
} from '@/stores/app-store'
import { SearchPanel } from '@/components/SearchPanel'
import { RightSidebar } from '@/components/RightSidebar'
import { useRightSidebarSearchFollow } from '@/hooks/useRightSidebarSearchFollow'

const getRightSidebarPanelSize = (size: number | string | undefined): string =>
  size === undefined ? RIGHT_SIDEBAR_DEFAULT_SIZE : typeof size === 'number' ? `${size}%` : size

const getPercentValue = (size: string): number => {
  const value = Number.parseFloat(size)
  return Number.isFinite(value) ? value : Number(RIGHT_SIDEBAR_DEFAULT_SIZE)
}

const RIGHT_SIDEBAR_MIN_SIZE = 280

export const SearchLayout = (): React.JSX.Element => {
  useRightSidebarSearchFollow()
  const displayInCompactMode = useAppStore(selectCompactMode)
  const setCompactMode = useAppStore((state) => state.setCompactMode)
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen)
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen)
  const searchPanelSize = useAppStore((state) => state.searchPanelSize)
  const setSearchPanelSize = useAppStore((state) => state.setSearchPanelSize)
  const rightSidebarSize = useAppStore((state) => state.rightSidebarSize)
  const setRightSidebarSize = useAppStore((state) => state.setRightSidebarSize)
  const setRightSidebarMaximized = useAppStore((state) => state.setRightSidebarMaximized)
  const rightSidebarResizeRequest = useAppStore((state) => state.rightSidebarResizeRequest)
  const [searchPanel, setSearchPanel] = usePanelCallbackRef()
  const [rightSidebarPanel, setRightSidebarPanel] = usePanelCallbackRef()
  const rightSidebarGroupRef = useRef<HTMLDivElement>(null)
  const [rightSidebarGroupWidth, setRightSidebarGroupWidth] = useState(0)
  const rightSidebarPanelSize = getRightSidebarPanelSize(rightSidebarSize)
  // Leave room for the separator so the pixel minimum stays below the 50% maximum.
  const rightSidebarMinSize = Math.min(RIGHT_SIDEBAR_MIN_SIZE, rightSidebarGroupWidth * 0.49)
  const rightSidebarOpenSize = rightSidebarGroupWidth
    ? `${Math.max(
        getPercentValue(rightSidebarPanelSize),
        (rightSidebarMinSize / rightSidebarGroupWidth) * 100
      )}%`
    : rightSidebarPanelSize
  const [initialRightSidebarSize] = useState(() =>
    rightSidebarOpen ? rightSidebarPanelSize : '0%'
  )
  const [initialWorkspaceSize] = useState(
    () => `${100 - (rightSidebarOpen ? getPercentValue(rightSidebarPanelSize) : 0)}%`
  )

  useLayoutEffect(() => {
    const group = rightSidebarGroupRef.current
    if (!group) return

    const observer = new ResizeObserver(() => setRightSidebarGroupWidth(group.clientWidth))
    observer.observe(group)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!searchPanel) return
    if (displayInCompactMode) {
      searchPanel.collapse()
    } else if (searchPanel.isCollapsed()) {
      searchPanel.resize(searchPanelSize === undefined ? '20%' : `${searchPanelSize}%`)
    }
  }, [displayInCompactMode, searchPanel, searchPanelSize])

  useEffect(() => {
    if (!rightSidebarPanel) return
    if (!rightSidebarOpen) {
      rightSidebarPanel.collapse()
      return
    }

    const frame = window.requestAnimationFrame(() => {
      rightSidebarPanel.resize(rightSidebarOpenSize)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [rightSidebarOpen, rightSidebarPanel, rightSidebarOpenSize, rightSidebarResizeRequest])

  return (
    <section className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup
        className="min-h-0 w-full flex-1 border-border"
        elementRef={rightSidebarGroupRef}
        onLayoutChanged={(layout, { isUserInteraction }) => {
          if (!isUserInteraction) return
          const nextRightSidebarSize = layout['right-sidebar']
          if (nextRightSidebarSize === undefined) return
          if (nextRightSidebarSize === 0) {
            setRightSidebarOpen(false)
          } else {
            setRightSidebarSize(nextRightSidebarSize)
          }
        }}
        orientation="horizontal"
      >
        <ResizablePanel
          defaultSize={initialWorkspaceSize}
          id="search-workspace"
          key="search-workspace"
          minSize={100}
        >
          <ResizablePanelGroup
            className="h-full min-h-0 w-full"
            id="search-workspace-layout"
            onLayoutChanged={(layout, { isUserInteraction }) => {
              if (!isUserInteraction) return
              const nextSearchPanelSize = layout['search-panel']
              if (nextSearchPanelSize === undefined) return
              if (nextSearchPanelSize === 0) {
                setCompactMode(true)
                return
              }
              setSearchPanelSize(nextSearchPanelSize)
              if (displayInCompactMode) setCompactMode(false)
            }}
            orientation="horizontal"
          >
            <ResizablePanel
              aria-hidden={displayInCompactMode}
              collapsible
              collapsedSize="0%"
              defaultSize={searchPanelSize === undefined ? '26.67' : `${searchPanelSize}%`}
              id="search-panel"
              inert={displayInCompactMode}
              key="search-panel"
              maxSize={300}
              minSize={180}
              panelRef={setSearchPanel}
            >
              <SearchPanel />
            </ResizablePanel>
            <ResizableHandle
              className={displayInCompactMode ? 'hidden' : ''}
              disabled={displayInCompactMode}
              key="search-panel-handle"
            />
            <ResizablePanel id="search-results" minSize={100}>
              <Outlet />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle className={rightSidebarOpen ? '' : 'hidden'} key="right-panel-handle" />
        <ResizablePanel
          aria-hidden={!rightSidebarOpen}
          collapsible
          collapsedSize="0%"
          defaultSize={initialRightSidebarSize}
          id="right-sidebar"
          inert={!rightSidebarOpen}
          key="right-panel"
          maxSize={RIGHT_SIDEBAR_MAX_SIZE}
          minSize={rightSidebarMinSize}
          onResize={(size) => {
            const isMaximized = size.asPercentage >= Number(RIGHT_SIDEBAR_MAX_SIZE) - 0.5
            setRightSidebarMaximized(isMaximized)
          }}
          panelRef={setRightSidebarPanel}
        >
          <RightSidebar />
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  )
}
