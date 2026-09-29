import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { useCallback, useEffect } from 'react'

interface AiLookupButtonProps {
  term: string
}

export function AiLookupButton({ term }: AiLookupButtonProps): React.JSX.Element {
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen)
  const activeTab = useAppStore((state) =>
    state.rightSidebarTabs.find((tab) => tab.id === state.activeRightSidebarTabId)
  )
  const openAiLookupTab = useAppStore((state) => state.openAiLookupTab)

  const isAiSearchActive = Boolean(
    rightSidebarOpen && activeTab?.kind === 'ai' && activeTab.term === term
  )

  const lookupTermInAISideBar = useCallback(
    (term: string): void => openAiLookupTab(term),
    [openAiLookupTab]
  )

  // 响应词典解释区的 "AI 解释" 请求
  useEffect(() => {
    return window.dictol.dictionaryView.onExplainWithAi((value) => {
      const text = value.trim()
      if (!text) return
      lookupTermInAISideBar(text)
    })
  }, [lookupTermInAISideBar])

  return (
    <Button
      aria-label="AI 查词"
      aria-pressed={isAiSearchActive}
      className={cn(
        'search-action-button size-7 shrink-0 rounded-lg',
        isAiSearchActive && 'search-action-button-active'
      )}
      onClick={() => lookupTermInAISideBar(term)}
      size="icon"
      title="使用 AI 查词"
      type="button"
      variant="ghost"
    >
      <Sparkles />
    </Button>
  )
}
