import type { ReactNode } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SELECTION_EXPLANATION_HEADER_HEIGHT } from '../../../shared/selection-explanation'

type Props = {
  title: string
  subtitle?: string
  children?: ReactNode
}

export function SelectionExplanationHeader({
  title,
  subtitle,
  children
}: Props): React.JSX.Element {
  return (
    <header
      className="drag-region flex shrink-0 items-center gap-3 border-b border-border bg-sidebar px-3"
      style={{ height: SELECTION_EXPLANATION_HEADER_HEIGHT }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
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
