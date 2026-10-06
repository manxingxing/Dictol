import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type SettingsSectionProps = {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

type SettingsRowProps = {
  label: string
  description?: string
  control: ReactNode
  className?: string
  controlClassName?: string
}

export function SettingsSection({
  title,
  description,
  children,
  className
}: SettingsSectionProps): React.JSX.Element {
  return (
    <section className={cn('py-6 first:pt-0 last:pb-0', className)}>
      <header className="mb-3">
        <h2 className="text-[15px] font-semibold leading-5">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        )}
      </header>
      {children}
    </section>
  )
}

export function SettingsList({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-muted/30', className)}>
      {children}
    </div>
  )
}

export function SettingsRow({
  label,
  description,
  control,
  className,
  controlClassName
}: SettingsRowProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-16 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 last:border-b-0 hover:bg-muted/40',
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium leading-5">{label}</p>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      <div className={cn('shrink-0', controlClassName)}>{control}</div>
    </div>
  )
}
