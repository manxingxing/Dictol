import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'

type DictionaryIconProps = {
  name: string
  iconUrl: string | null | undefined
}

export function DictionaryTabIcon({ name, iconUrl }: DictionaryIconProps): React.JSX.Element {
  const display = useAppStore((state) => state.dictionaryDisplay) ?? 'icon'
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null)
  const hasIcon = Boolean(iconUrl && failedIconUrl !== iconUrl)
  const initial = Array.from(name.trim())[0] ?? '?'

  const icon = hasIcon ? (
    <img
      alt=""
      className="size-full object-cover bg-white"
      onError={() => setFailedIconUrl(iconUrl ?? null)}
      src={iconUrl ?? undefined}
    />
  ) : (
    <span aria-hidden="true">{initial}</span>
  )

  if (display === 'icon') {
    return (
      <>
        <span className="dictionary-source-icon flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-background text-[11px] font-semibold text-muted-foreground group-data-[state=active]:text-primary">
          {icon}
        </span>
        <span aria-hidden="true" className="dictionary-tab-indicator" />
      </>
    )
  }

  return (
    <span className="dictionary-source-label inline-flex max-w-44 items-center gap-1.5 rounded-lg border border-border bg-muted/45 px-2.5 py-1.5 text-xs font-medium text-muted-foreground group-data-[state=active]:border-primary/35 group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary">
      {display === 'icon-and-name' && (
        <span className="dictionary-source-icon flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background text-[8px] font-semibold">
          {icon}
        </span>
      )}
      <span className="truncate">{name}</span>
    </span>
  )
}

export function DictionaryAvatar({ name, iconUrl }: DictionaryIconProps): React.JSX.Element {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null)
  const hasIcon = Boolean(iconUrl && failedIconUrl !== iconUrl)
  const initial = Array.from(name.trim())[0] ?? '?'

  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
      {hasIcon ? (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => setFailedIconUrl(iconUrl ?? null)}
          src={iconUrl ?? undefined}
        />
      ) : (
        <span aria-hidden="true" className="text-sm font-medium text-muted-foreground">
          {initial}
        </span>
      )}
    </span>
  )
}
