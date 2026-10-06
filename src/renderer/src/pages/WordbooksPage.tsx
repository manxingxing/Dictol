import { useState } from 'react'

import {
  BookMarked,
  FolderPlus,
  List,
  MoreHorizontal,
  Pencil,
  Trash2
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

import {
  useWordbooks,
  type WordbookSummary
} from '@/hooks/use-wordbooks'
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { CreateWordbookDialog } from '@/components/wordbook/CreateWordbookDialog'
import { DeleteWordbookDialog } from '@/components/wordbook/DeleteWordbookDialog'
import { RenameWordbookDialog } from '@/components/wordbook/RenameWordbookDialog'

export function WordbooksPage(): React.JSX.Element {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const {
    data: wordbooks = [],
    isLoading: isWordbooksLoading,
    isError: isWordbooksError
  } = useWordbooks()

  // ---------- rename dialog ----------
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const openRenameDialog = (wordbook: WordbookSummary): void => {
    setRenameTarget({ id: wordbook.id, name: wordbook.name })
  }

  // ---------- delete dialog ----------
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const openDeleteDialog = (wordbook: WordbookSummary): void => {
    setDeleteTarget({ id: wordbook.id, name: wordbook.name })
  }

  return (
    <section className="flex lg:h-full min-h-0 flex-1 flex-col bg-background lg:flex-row">
      <aside className="hidden min-h-0 w-54 shrink-0 flex-col border-r border-border bg-sidebar/35 p-3 lg:flex lg:h-full">
        <div className="hidden lg:flex mb-2 items-center justify-between px-1 lg:mb-3">
          <h1 className="text-sm font-semibold lg:block">生词本</h1>
          <CreateWordbookDialog onOpenChange={setCreateDialogOpen} open={createDialogOpen} />
        </div>

        <div className="hidden min-h-0 flex-1 flex-col lg:flex">
          <WordbookNavigation
            onDelete={openDeleteDialog}
            onRename={openRenameDialog}
            wordbooks={wordbooks}
          />
          <WordbookStatus isError={isWordbooksError} isLoading={isWordbooksLoading} />
        </div>
      </aside>

      {renameTarget && (
        <RenameWordbookDialog
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null)
          }}
          wordbook={renameTarget}
        />
      )}
      { deleteTarget &&
        <DeleteWordbookDialog
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          wordbook={deleteTarget}
        />
      }

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6 sm:p-8">
        <Outlet
          context={{
            onCreateWordbook: () => setCreateDialogOpen(true),
            wordbookStatus: (
              <WordbookStatus isError={isWordbooksError} isLoading={isWordbooksLoading} />
            )
          }}
        />
      </div>
    </section>
  )
}

type WordbookNavigationProps = {
  onDelete?: (wordbook: WordbookSummary) => void
  onRename?: (wordbook: WordbookSummary) => void
  wordbooks: WordbookSummary[]
}

function WordbookNavigation({
  onDelete,
  onRename,
  wordbooks
}: WordbookNavigationProps): React.JSX.Element {
  const wordTotalCount = wordbooks.reduce((sum, wordbook) => sum + wordbook.wordCount, 0)

  return (
    <nav aria-label="生词本列表" className="flex flex-col gap-1.5">
      <NavLink
        to="/wordbooks"
        end
        className={({ isActive }) =>
          cn(
            'flex h-9 w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm',
            isActive
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )
        }
      >
        <List className="size-4 shrink-0" />
        <span className={'flex-1'}>全部</span>
        <span className="text-xs tabular-nums">{wordTotalCount}</span>
      </NavLink>

      {wordbooks.map((wordbook) => (
        <div className="group relative" key={wordbook.id}>
          <NavLink
            to={`/wordbooks/${wordbook.id}`}
            className={({ isActive }) =>
              cn(
                'flex h-9 w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm',
                isActive
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            {wordbook.isDefault ? (
              <BookMarked className="size-4 shrink-0" />
            ) : (
              <FolderPlus className="size-4 shrink-0" />
            )}
            <span className="flex-1 truncate">{wordbook.name}</span>
            <span
              className={cn('text-xs tabular-nums', !wordbook.isDefault && 'group-hover:hidden')}
            >
              {wordbook.wordCount}
            </span>
          </NavLink>

          {!wordbook.isDefault && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 opacity-0 hover:bg-transparent group-hover:pointer-events-auto group-hover:opacity-100"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-28">
                <DropdownMenuItem className="text-sm" onClick={() => onRename?.(wordbook)}>
                  <Pencil className="size-3.5" />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-sm hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
                  onClick={() => onDelete?.(wordbook)}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ))}
    </nav>
  )
}

function WordbookStatus({
  isError,
  isLoading
}: {
  isError: boolean
  isLoading: boolean
}): React.JSX.Element {
  return (
    <>
      {isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">正在加载…</p>}
      {isError && <p className="px-3 py-2 text-xs text-destructive">加载生词本失败。</p>}
    </>
  )
}
