import { useLayoutEffect, useRef } from 'react'
import { Clock3 } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { QueryHistoryItem } from '@/hooks/use-query-history'
import { useAppStore } from '@/stores/app-store'

type SearchHistoryProps = {
  history: QueryHistoryItem[]
  selectedIndex: number
  onPointerMove: (index: number) => void
}

export function SearchHistory({
  history,
  selectedIndex,
  onPointerMove
}: SearchHistoryProps): React.JSX.Element {
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)
  const recentTerms = history.slice(0, 50)
  const itemRefs = useRef<Array<HTMLLIElement | null>>([])

  useLayoutEffect(() => {
    if (selectedIndex < 0) return
    itemRefs.current[selectedIndex]?.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest'
    })
  }, [selectedIndex])

  if (recentTerms.length === 0) {
    return <p className="px-3 py-8 text-center text-sm text-muted-foreground">输入单词开始查询</p>
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-1 text-xs font-medium text-muted-foreground">
        <Clock3 className="size-3.5" />
        最近查询
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:!block">
        <ul className="space-y-1">
          {recentTerms.map((item, index) => (
            <li
              key={item.id}
              ref={(element) => {
                itemRefs.current[index] = element
              }}
            >
              <NavLink
                className="block"
                onClick={() => setSearchQuery(item.term)}
                to={`/search/${encodeURIComponent(item.term)}`}
              >
                {({ isActive }) => (
                  <Button
                    className={`h-auto w-full justify-start px-3 py-2.5 text-left ${
                      selectedIndex === index
                        ? 'bg-primary/10 font-medium text-primary ring-1 ring-inset ring-primary/20'
                        : selectedIndex < 0 && isActive
                          ? 'bg-primary/12 font-medium text-primary ring-1 ring-inset ring-primary/20'
                          : 'text-foreground'
                    }`}
                    onPointerMove={() => onPointerMove(index)}
                    variant="ghost"
                  >
                    <span className="min-w-0 truncate">{item.term}</span>
                  </Button>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </>
  )
}
