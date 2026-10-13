import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { DictionaryNotesSidebar } from '@/components/dictionaryNote/DictionaryNotesSidebar'
import { selectCompactMode, useAppStore, type RightSidebarNotesTab } from '@/stores/app-store'
import { MAIN_WINDOW_TITLEBAR_HEIGHT } from '../../../../shared/window-chrome'

export function DictionaryNotesDrawer({
  open,
  term,
  onOpenChange
}: {
  open: boolean
  term: string
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const compactMode = useAppStore(selectCompactMode)
  const tab: RightSidebarNotesTab = {
    id: 'notes',
    kind: 'notes',
    title: '笔记',
    term,
    openRequestVersion: 0
  }

  return (
    <Drawer onOpenChange={onOpenChange} open={open} swipeDirection="right">
      <DrawerContent
        className="[--drawer-inset:12px] rounded-xl border border-border"
        modalRegionStyle={{ top: MAIN_WINDOW_TITLEBAR_HEIGHT, left: compactMode ? 48 : 60 }}
        style={{ top: MAIN_WINDOW_TITLEBAR_HEIGHT }}
      >
        <DrawerTitle className="sr-only">{tab.term} 的笔记与摘抄</DrawerTitle>
        <DrawerClose
          aria-label="关闭笔记抽屉"
          className="absolute right-3 top-1 z-10"
          render={
            <Button
              aria-label="关闭笔记抽屉"
              className="size-8"
              size="icon"
              type="button"
              variant="ghost"
            />
          }
        >
          <X className="size-4" />
        </DrawerClose>
        <DictionaryNotesSidebar active={open} key={term} tab={tab} />
      </DrawerContent>
    </Drawer>
  )
}
