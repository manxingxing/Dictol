import { ArrowUpDown, LoaderCircle } from 'lucide-react'
import { flexRender, type Column, type Table as TanStackTable } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { DataTablePagination } from '@/components/data-table-pagination'
import { type WordbookWordItem } from '@/hooks/use-wordbooks'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

const sortOptions = [
  { id: 'word', label: '单词' },
  { id: 'star', label: '星级' },
  { id: 'createdAt', label: '添加时间' }
] as const

export function WordbookWordsTable({
  table,
  loading,
  error,
  empty,
  page,
  pageSize,
  total,
  onPageChange
}: {
  table: TanStackTable<WordbookWordItem>
  loading: boolean
  error: boolean
  empty: React.ReactNode
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}): React.JSX.Element {
  const rows = table.getRowModel().rows
  const activeSort = table.getState().sorting[0]
  const sortLabel = sortOptions.find((option) => option.id === activeSort?.id)?.label
  const showWordbookName = table
    .getAllLeafColumns()
    .some((column) => column.id === 'wordbookName')
  const gridColumns = showWordbookName
    ? 'grid-cols-[40px_minmax(130px,1fr)_minmax(180px,1.5fr)_minmax(72px,96px)_minmax(140px,1fr)_110px_100px_88px]'
    : 'grid-cols-[40px_minmax(130px,1fr)_minmax(180px,1.5fr)_minmax(140px,1fr)_110px_100px_88px]'
  const gridWidth = showWordbookName ? 'min-w-[948px]' : 'min-w-[866px]'

  const getPinnedStyle = (column: Column<WordbookWordItem>): React.CSSProperties => {
    const pinned = column.getIsPinned()
    if (!pinned) return {}
    return {
      position: 'sticky',
      left: pinned === 'left' ? `${column.getStart('left')}px` : undefined,
      right: pinned === 'right' ? `${column.getAfter('right')}px` : undefined,
      zIndex: 2
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          正在加载单词…
        </div>
      ) : error ? (
        <p className="p-6 text-sm text-destructive">加载失败。</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">{empty}</div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between border-b px-2 py-2">
            <span className="text-xs text-muted-foreground">
              已选 {table.getSelectedRowModel().rows.length} 项
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-7" size="sm" type="button" variant="ghost">
                  <ArrowUpDown className="size-3.5" />
                  {sortLabel ? `${sortLabel}${activeSort?.desc ? ' ↓' : ' ↑'}` : '排序'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>排序方式</DropdownMenuLabel>
                {sortOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.id}
                    onSelect={() =>
                      table.setSorting([
                        {
                          id: option.id,
                          desc: activeSort?.id === option.id ? !activeSort.desc : false
                        }
                      ])
                    }
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
                {activeSort && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => table.setSorting([])}>
                      恢复默认顺序
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <div
              className={`wordbook-list-header sticky top-0 z-10 grid ${gridWidth} ${gridColumns} items-center gap-0 border-b py-2 text-xs font-medium text-muted-foreground`}
            >
              {table.getHeaderGroups().flatMap((group) =>
                group.headers.map((header) => {
                  return (
                    <div
                      className={`px-2 ${header.column.id === 'select' ? 'px-1' : ''} ${header.column.id === 'actions' ? 'px-0' : ''} ${header.column.getIsPinned() ? 'wordbook-list-pinned-header' : ''}`}
                      key={header.id}
                      style={getPinnedStyle(header.column)}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </div>
                  )
                })
              )}
            </div>
            {rows.map((row) => (
              <div
                className={`wordbook-list-row group grid ${gridWidth} ${gridColumns} items-center gap-0 border-b py-2 text-sm ${row.getIsSelected() ? 'is-selected' : ''}`}
                key={row.id}
              >
                {row.getVisibleCells().map((cell) => {
                  return (
                    <div
                      className={`min-w-0 overflow-hidden px-2 ${cell.column.id === 'select' ? 'px-1' : ''} ${cell.column.id === 'actions' ? 'px-0' : ''} ${cell.column.getIsPinned() ? 'wordbook-list-pinned-cell' : ''}`}
                      key={cell.id}
                      style={getPinnedStyle(cell.column)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {total > 0 && (
            <DataTablePagination
              onPageChange={onPageChange}
              page={page}
              pageSize={pageSize}
              total={total}
            />
          )}
        </>
      )}
    </div>
  )
}
