import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

const dictionarySections = [
  { label: '本地词典', to: '/dictionaries/local' },
  { label: '在线词典', to: '/dictionaries/online' }
]

export function DictionaryManagementLayout(): React.JSX.Element {
  return (
    <section className="mx-auto flex max-w-3xl flex-col p-6 sm:p-8">
      <p className="mb-2 text-sm font-medium text-primary">词典库</p>
      <h1 className="text-xl font-semibold tracking-tight">管理你的词典</h1>

      <nav aria-label="词典类型" className="mt-6 flex w-fit items-center gap-1">
        {dictionarySections.map((section) => (
          <NavLink
            className={({ isActive }) =>
              cn(
                'inline-flex h-9 items-center rounded-full border border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                isActive &&
                  'border-primary/45 bg-primary/8 text-primary hover:bg-primary/8 hover:text-primary'
              )
            }
            key={section.to}
            to={section.to}
          >
            {section.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-4">
        <Outlet />
      </div>
    </section>
  )
}
