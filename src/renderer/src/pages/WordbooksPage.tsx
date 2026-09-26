import { useState } from 'react'

import {
  BookMarked,
  FolderPlus,
  List,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'

import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

import {
  useCreateWordbook,
  useDeleteWordbook,
  useRenameWordbook,
  useWordbooks,
  type WordbookSummary
} from '@/hooks/use-wordbooks'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function WordbooksPage(): React.JSX.Element {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newWordbookName, setNewWordbookName] = useState('')
  const navigate = useNavigate()

  const {
    data: wordbooks = [],
    isLoading: isWordbooksLoading,
    isError: isWordbooksError
  } = useWordbooks()
  const createWordbook = useCreateWordbook()
  const renameWordbook = useRenameWordbook()
  const deleteWordbook = useDeleteWordbook()

  // ---------- rename dialog ----------
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // ---------- delete dialog ----------
  const [sidebarDeleteOpen, setSidebarDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const submitNewWordbook = (): void => {
    createWordbook.mutate(newWordbookName, {
      onSuccess: (created) => {
        setNewWordbookName('')
        setCreateDialogOpen(false)
        navigate(`/wordbooks/${created.id}`)
      }
    })
  }

  const openRenameDialog = (wordbook: WordbookSummary): void => {
    setRenameTarget({ id: wordbook.id, name: wordbook.name })
    setRenameValue(wordbook.name)
    setRenameDialogOpen(true)
  }

  const openDeleteDialog = (wordbook: WordbookSummary): void => {
    setDeleteTarget({ id: wordbook.id, name: wordbook.name })
    setSidebarDeleteOpen(true)
  }

  return (
    <section className="flex lg:h-full min-h-0 flex-1 flex-col bg-background lg:flex-row">
      <aside className="hidden min-h-0 w-54 shrink-0 flex-col border-r border-border bg-sidebar/35 p-3 lg:flex lg:h-full">
        <div className="hidden lg:flex mb-2 items-center justify-between px-1 lg:mb-3">
          <h1 className="text-sm font-semibold lg:block">生词本</h1>
          <Dialog onOpenChange={setCreateDialogOpen} open={createDialogOpen}>
            <DialogTrigger asChild>
              <Button
                aria-label="新建生词本"
                className=""
                size="sm"
                title="新建生词本"
                type="button"
                variant="ghost"
              >
                <Plus />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建生词本</DialogTitle>
                <DialogDescription>为单词创建一个新的分类生词本。</DialogDescription>
              </DialogHeader>
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitNewWordbook()
                }}
              >
                <Input
                  autoFocus
                  maxLength={100}
                  onChange={(event) => setNewWordbookName(event.target.value)}
                  placeholder="例如：托福核心词"
                  value={newWordbookName}
                />
                {createWordbook.isError && (
                  <p className="text-sm text-destructive">{createWordbook.error.message}</p>
                )}
                <DialogFooter>
                  <Button
                    disabled={!newWordbookName.trim() || createWordbook.isPending}
                    type="submit"
                  >
                    {createWordbook.isPending && <LoaderCircle className="animate-spin" />}
                    创建
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="hidden min-h-0 flex-1 flex-col lg:flex">
          <WordbookNavigation
            onDelete={openDeleteDialog}
            onRename={openRenameDialog}
            wordbooks={wordbooks}
          />
          <WordbookStatus isError={isWordbooksError} isLoading={isWordbooksLoading} />
        </div>
        {/* ---------- rename dialog ---------- */}
        <Dialog
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null)
            setRenameDialogOpen(open)
          }}
          open={renameDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>重命名生词本</DialogTitle>
              <DialogDescription>为「{renameTarget?.name}」输入新名称。</DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (!renameTarget || !renameValue.trim()) return
                renameWordbook.mutate(
                  { wordbookId: renameTarget.id, name: renameValue.trim() },
                  {
                    onSuccess: () => {
                      setRenameDialogOpen(false)
                      toast.success('重命名成功')
                    },
                    onError: (error) => toast.error(error.message)
                  }
                )
              }}
            >
              <Input
                autoFocus
                maxLength={100}
                onChange={(e) => setRenameValue(e.target.value)}
                value={renameValue}
              />
              {renameWordbook.isError && (
                <p className="text-sm text-destructive">{renameWordbook.error.message}</p>
              )}
              <DialogFooter>
                <Button
                  disabled={
                    !renameValue.trim() ||
                    renameValue.trim() === renameTarget?.name ||
                    renameWordbook.isPending
                  }
                  type="submit"
                >
                  {renameWordbook.isPending && <LoaderCircle className="animate-spin" />}
                  保存
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ---------- delete dialog ---------- */}
        <Dialog
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
            setSidebarDeleteOpen(open)
          }}
          open={sidebarDeleteOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认删除</DialogTitle>
              <DialogDescription>
                将删除生词本「{deleteTarget?.name}」及其所有单词，此操作不可撤销。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                disabled={deleteWordbook.isPending}
                onClick={() => setSidebarDeleteOpen(false)}
                type="button"
                variant="outline"
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={deleteWordbook.isPending}
                onClick={() => {
                  if (!deleteTarget) return
                  deleteWordbook.mutate(deleteTarget.id, {
                    onSuccess: () => {
                      setSidebarDeleteOpen(false)
                      toast.success('生词本已删除')
                      // If we're currently viewing the deleted wordbook, nav to list
                      if (window.location.pathname === `/wordbooks/${deleteTarget.id}`) {
                        navigate('/wordbooks')
                      }
                    },
                    onError: (error) => toast.error(error.message)
                  })
                }}
                type="button"
              >
                {deleteWordbook.isPending && <LoaderCircle className="animate-spin" />}
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </aside>

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
    <nav aria-label="生词本列表" className="flex flex-col gap-1">
      <NavLink
        to="/wordbooks"
        end
        className={({ isActive }) =>
          cn(
            'flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm transition-colors',
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
                'flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm transition-colors',
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
                  className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity hover:bg-transparent group-hover:pointer-events-auto group-hover:opacity-100"
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
