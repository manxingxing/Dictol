import { type FormEvent, type ReactNode } from 'react'
import { Pin, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SELECTION_EXPLANATION_HEADER_HEIGHT } from '../../../shared/selection-explanation'

type Props = {
  title: string
  subtitle?: string
  onSearch?: (word: string) => void
  pinned?: boolean
  children?: ReactNode
}

export function SelectionExplanationHeader({
  title,
  subtitle,
  onSearch,
  pinned = false,
  children
}: Props): React.JSX.Element {
  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const normalizedWord = String(new FormData(event.currentTarget).get('word') ?? '').trim()
    if (normalizedWord) onSearch?.(normalizedWord)
  }

  return (
    <header
      className="drag-region flex shrink-0 items-center gap-3 border-b border-border bg-sidebar px-3"
      style={{ height: SELECTION_EXPLANATION_HEADER_HEIGHT }}
    >
      <div className="min-w-0 flex-1">
        {onSearch ? (
          <form key={title} className="no-drag w-fit max-w-full min-w-0" onSubmit={submitSearch}>
            <input
              aria-label="查找词条"
              className="selection-explanation-word-input h-7 max-w-full rounded border border-transparent bg-transparent px-1.5 text-sm font-semibold outline-none transition-colors hover:border-primary/60 hover:bg-primary/5 focus:border-primary focus:bg-primary/5"
              defaultValue={title}
              maxLength={200}
              name="word"
              type="text"
            />
          </form>
        ) : (
          <p className="truncate text-sm font-semibold">{title}</p>
        )}
        {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
      <Button
        aria-label={pinned ? '取消置顶' : '置顶窗口'}
        aria-pressed={pinned}
        className={`no-drag size-7 shrink-0 ${pinned ? 'text-primary' : ''}`}
        onClick={() => window.dictolSelectionExplanation.togglePin()}
        size="icon"
        title={pinned ? '取消置顶' : '置顶窗口'}
        type="button"
        variant="ghost"
      >
        <Pin fill={pinned ? 'currentColor' : 'none'} />
      </Button>
      <Button
        aria-label="关闭解释窗口"
        className="no-drag size-7 shrink-0"
        onClick={() => window.dictolSelectionExplanation.close()}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X />
      </Button>
    </header>
  )
}
