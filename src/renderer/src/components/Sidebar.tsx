import { NavLink } from 'react-router-dom'
import { BookMarked, History, Languages, Library, Search, Settings } from 'lucide-react'

import appIcon from '@/assets/icon_320x320.png'
import { Button } from '@/components/ui/button'
import { useAiLookupConfig } from '@/hooks/use-ai-lookup'
import { cn } from '@/lib/utils'
import { selectCompactMode, useAppStore } from '@/stores/app-store'

const navigation = [
  { label: '查词', path: '/search', icon: Search },
  { label: '历史', path: '/history', icon: History },
  { label: '生词本', path: '/wordbooks', icon: BookMarked }
]

export function Sidebar(): React.JSX.Element {
  const lastQueryPath = useAppStore((state) => state.lastQueryPath)
  const displayInCompactMode = useAppStore(selectCompactMode)
  const aiConfig = useAiLookupConfig()
  const items = aiConfig.data?.enabled
    ? [...navigation, { label: '翻译', path: '/translation', icon: Languages }]
    : navigation

  return (
    <aside
      className={cn(
        'app-chrome-surface flex shrink-0 flex-col overflow-hidden border-r border-border pt-3.5 pb-3 transition-[width,padding] duration-150 ease-out',
        displayInCompactMode ? 'w-12 px-1' : 'w-[3.75rem] px-[6px]'
      )}
    >
      <div
        className={cn('flex justify-center', displayInCompactMode ? 'mb-4 h-7' : 'mb-[22px] h-9')}
      >
        <div
          className={cn(
            'overflow-hidden shadow-sm',
            displayInCompactMode ? 'size-7 rounded-lg' : 'size-9 rounded-xl'
          )}
          title="Dictol"
        >
          <img alt="" className="size-full object-cover" src={appIcon} />
        </div>
      </div>

      <nav className={cn(displayInCompactMode ? 'space-y-2' : 'space-y-2.5')} aria-label="主导航">
        {items.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path === '/search' ? (lastQueryPath ?? path) : path}
            className="block"
          >
            {({ isActive }) => (
              <Button
                aria-label={label}
                className={cn(
                  'h-auto w-full flex-col px-0',
                  displayInCompactMode ? 'gap-0 py-2' : 'gap-1 py-1.5',
                  isActive
                    ? 'bg-primary/8 font-medium text-primary ring-1 ring-inset ring-primary/20 hover:bg-primary/12'
                    : 'text-muted-foreground'
                )}
                title={label}
                variant="ghost"
              >
                <Icon className={displayInCompactMode ? 'size-4' : 'size-5'} />
                {!displayInCompactMode && <span className="text-[11px]">{label}</span>}
              </Button>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={cn('mt-auto', displayInCompactMode ? 'space-y-2' : 'space-y-2.5')}>
        <NavLink to="/dictionaries" className="block">
          {({ isActive }) => (
            <Button
              aria-label="词典库"
              className={cn(
                'h-auto w-full flex-col px-0',
                displayInCompactMode ? 'gap-0 py-2' : 'gap-1 py-1.5',
                isActive
                  ? 'bg-primary/12 font-medium text-primary ring-1 ring-inset ring-primary/20'
                  : 'text-muted-foreground'
              )}
              title="词典库"
              variant="ghost"
            >
              <Library className={displayInCompactMode ? 'size-4' : 'size-5'} />
              {!displayInCompactMode && <span className="text-[11px]">词典库</span>}
            </Button>
          )}
        </NavLink>
        <NavLink to="/settings" className="block">
          {({ isActive }) => (
            <Button
              aria-label="设置"
              className={cn(
                'h-auto w-full flex-col px-0',
                displayInCompactMode ? 'gap-0 py-2' : 'gap-1 py-1.5',
                isActive
                  ? 'bg-primary/12 font-medium text-primary ring-1 ring-inset ring-primary/20'
                  : 'text-muted-foreground'
              )}
              title="设置"
              variant="ghost"
            >
              <Settings className={displayInCompactMode ? 'size-4' : 'size-5'} />
              {!displayInCompactMode && <span className="text-[11px] leading-none">设置</span>}
            </Button>
          )}
        </NavLink>
      </div>
    </aside>
  )
}
