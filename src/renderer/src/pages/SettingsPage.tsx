import { Info, Keyboard, Languages, MousePointer2, Sparkles, SunMoon, Volume2 } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'

const settingsNavigation = [
  { label: '外观', path: 'appearance', icon: SunMoon },
  { label: '取词', path: 'capture', icon: MousePointer2 },
  { label: '翻译', path: 'translation', icon: Languages },
  { label: 'AI 增强', path: 'ai', icon: Sparkles },
  { label: '朗读', path: 'tts', icon: Volume2 },
  { label: '快捷键', path: 'keyboard', icon: Keyboard },
  { label: '关于', path: 'about', icon: Info }
]

export function SettingsPage(): React.JSX.Element {
  const { pathname } = useLocation()
  const currentPage =
    settingsNavigation.find(({ path }) => pathname === `/settings/${path}`) ?? settingsNavigation[0]

  return (
    <section className="flex h-full min-h-0 bg-background">
      <aside className="flex h-full w-40 shrink-0 flex-col overflow-y-auto bg-sidebar/35 px-3 py-5 md:w-48 lg:w-56">
        <p className="px-1 text-lg font-semibold">设置</p>
        <nav aria-label="设置页面" className="mt-6 flex flex-col gap-1">
          {settingsNavigation.map(({ label, path, icon: Icon }) => (
            <NavLink
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-2 rounded-lg px-3 text-sm hover:bg-foreground/5',
                  isActive && 'bg-foreground/8 font-medium hover:bg-foreground/8'
                )
              }
              key={path}
              to={path}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div
        className="min-h-0 min-w-0 flex-1 overflow-y-auto border-l border-border bg-background px-2 py-8 md:px-6 lg:px-12 lg:py-9"
        key={pathname}
      >
        <div className="mx-auto max-w-3xl">
          <p className="mb-2 text-sm font-medium text-primary">设置</p>
          <h1 className="text-xl font-semibold tracking-tight">{currentPage.label}</h1>
          <div className="mt-8">
            <Outlet />
          </div>
        </div>
      </div>
    </section>
  )
}
