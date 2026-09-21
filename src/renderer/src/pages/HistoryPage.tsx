import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, LoaderCircle, Search, Trash2 } from 'lucide-react'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

import { useAppStore } from '@/stores/app-store'
import {
  useClearQueryHistory,
  useQueryHistory,
  type QueryHistoryItem
} from '@/hooks/use-query-history'
import { cn, formatTime } from '@/lib/utils'

function getColumnClassName(columnId: string, header: boolean): string | undefined {
  switch (columnId) {
    case 'term':
      return header ? undefined : 'max-w-0'
    case 'queryCount':
      return 'w-20 text-right'
    case 'lastQueriedAt':
      return 'w-36 text-right'
    case 'actions':
      return 'w-28 text-right'
    default:
      return undefined
  }
}

export const HistoryPage = (): React.JSX.Element => {
  const navigate = useNavigate()
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)

  const { data: history = [], isLoading, isError } = useQueryHistory()
  const clearHistory = useClearQueryHistory()

  const searchHistoryTerm = useCallback(
    async (term: string): Promise<void> => {
      setSearchQuery(term)
      await navigate(`/search/${encodeURIComponent(term)}`)
    },
    [navigate, setSearchQuery]
  )

  const confirmClearHistory = async (): Promise<void> => {
    try {
      await clearHistory.mutateAsync()
      setClearDialogOpen(false)
    } catch {
      // The mutation error is shown in the confirmation dialog.
    }
  }

  const columns = useMemo<ColumnDef<QueryHistoryItem>[]>(
    () => [
      {
        accessorKey: 'term',
        header: '词条',
        cell: ({ getValue }): React.JSX.Element => (
          <span className="block truncate font-medium">{getValue<string>()}</span>
        )
      },
      {
        accessorKey: 'queryCount',
        header: '查询次数',
        cell: ({ getValue }): React.JSX.Element => (
          <span className="tabular-nums">{getValue<number>().toLocaleString('zh-CN')}</span>
        )
      },
      {
        accessorKey: 'lastQueriedAt',
        header: '最后查询',
        cell: ({ getValue }): React.JSX.Element => {
          const lastQueriedAt = getValue<string>()
          return (
            <time dateTime={lastQueriedAt} className="text-muted-foreground">
              {formatTime(lastQueriedAt)}
            </time>
          )
        }
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }): React.JSX.Element => (
          <Button
            aria-label={`查询 ${row.original.term}`}
            onClick={() => {
              void searchHistoryTerm(row.original.term).catch((error: unknown) => {
                console.error('Failed to open query history entry', error)
              })
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Search />
            查询
          </Button>
        )
      }
    ],
    [searchHistoryTerm]
  )

  // TanStack Table returns mutable APIs that React Compiler intentionally does not memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: history,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id)
  })

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-col p-6 sm:min-h-full sm:p-8">
      <p className="mb-2 text-sm font-medium text-primary">查询历史</p>
      <h1 className="text-xl font-semibold tracking-tight">最近查询</h1>

      <section className="min-h-0 flex-1 mt-8">
        <div className="mb-3 flex items-start justify-between gap-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-5">最近访问的词条</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              共 {history.length} 条记录
            </p>
          </div>
          <Button
            className="shrink-0 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            disabled={clearHistory.isPending}
            onClick={() => {
              clearHistory.reset()
              setClearDialogOpen(true)
            }}
            type="button"
            variant="outline"
          >
            <Trash2 />
            清空历史
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-border bg-muted/30">
          {isLoading && (
            <p className="bg-card px-4 py-5 text-sm text-muted-foreground">正在加载…</p>
          )}
          {isError && (
            <p className="bg-card px-4 py-5 text-sm text-destructive">加载查询历史失败。</p>
          )}
          {!isLoading && !isError && history.length === 0 && (
            <div className="bg-card px-4 py-10 text-center">
              <History className="mx-auto mb-3 size-6 text-primary" />
              <p className="text-sm font-medium">暂无查询记录</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                查询单词后，最近访问的词条会显示在这里。
              </p>
            </div>
          )}
          {!isLoading && !isError && history.length > 0 && (
            <Table
              className="min-w-0 table-fixed"
              containerClassName="max-w-full max-h-full overflow-x-hidden overflow-y-auto"
            >
              <TableHeader className="sticky top-0 z-10 bg-muted/30">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow className="hover:bg-transparent" key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        className={cn('px-4', getColumnClassName(header.column.id, true))}
                        key={header.id}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow className="bg-card hover:bg-muted/40" key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        className={cn('px-4 py-2', getColumnClassName(cell.column.id, false))}
                        key={cell.id}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <p className="py-2 text-xs text-center leading-6 text-muted-foreground">
          最多保留 200 条记录, 重复查询会更新到列表顶部
        </p>
      </section>

      <Dialog
        onOpenChange={(open) => {
          if (!clearHistory.isPending) setClearDialogOpen(open)
        }}
        open={clearDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空查询历史</DialogTitle>
            <DialogDescription>这会移除所有最近查询记录，且无法恢复。</DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-6">确定要清空全部查询历史吗？</p>
          {clearHistory.isError && (
            <p className="text-sm text-destructive">清空查询历史失败，请重试。</p>
          )}
          <DialogFooter>
            <Button
              disabled={clearHistory.isPending}
              onClick={() => setClearDialogOpen(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={clearHistory.isPending}
              onClick={() => void confirmClearHistory()}
              type="button"
              variant="destructive"
            >
              {clearHistory.isPending && <LoaderCircle className="animate-spin" />}
              清空历史
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
