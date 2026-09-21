import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type Table as TanStackTable,
  type VisibilityState
} from '@tanstack/react-table'
import {
  ArrowUpDown,
  BookMarked,
  ChevronDown,
  Download,
  LoaderCircle,
  Search,
  Trash2,
  Upload
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { StarRating } from '@/components/ui/star-rating'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { DataTablePagination } from '@/components/data-table-pagination'

import { formatTime } from '@/lib/utils'
import {
  useExportWordbooks,
  useFilterWords,
  useImportWordbookWords,
  useMoveWordbookWords,
  useUnStarWord,
  useUpdateStar,
  useWordbookExportStatus,
  useWordbookWords,
  useWordbooks,
  useDeleteWords,
  type WordbookWordItem
} from '@/hooks/use-wordbooks'
import { useNavigate, useParams } from 'react-router-dom'

import { useAppStore } from '@/stores/app-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportScope = 'all' | 'wordbook' | 'selected'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function columnClass(columnId: string): string | undefined {
  switch (columnId) {
    case 'select':
      return 'w-11'
    case 'word':
      return 'w-36'
    case 'translation':
      return 'w-[36%] max-w-0'
    case 'wordbookName':
      return 'w-28'
    case 'star':
      return 'w-24 text-center'
    case 'createdAt':
      return 'w-30'
    case 'actions':
      return 'w-20 text-center'
    default:
      return undefined
  }
}

type CompactSortColumn = 'word' | 'star' | 'createdAt'

const compactSortOptions: Array<{ id: CompactSortColumn; label: string }> = [
  { id: 'word', label: '单词' },
  { id: 'star', label: '星级' },
  { id: 'createdAt', label: '添加时间' }
]

function useElementWidth(): [(node: HTMLDivElement | null) => void, number | null] {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)

  const ref = useCallback((node: HTMLDivElement | null) => setElement(node), [])

  useEffect(() => {
    if (!element) return

    const updateWidth = (): void => setWidth(element.clientWidth)
    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [ref, width]
}

type WordbookCompactListProps = {
  table: TanStackTable<WordbookWordItem>
  emptyMessage: ReactNode
  isError: boolean
  isLoading: boolean
  isRemoving: boolean
  loadingMessage: string
  showWordbookName: boolean
  onLookupWord: (word: string) => void
  onRemoveWord: (word: string) => void
  onUpdateStar: (word: string, star: number) => void
}

function WordbookCompactList({
  table,
  emptyMessage,
  isError,
  isLoading,
  isRemoving,
  loadingMessage,
  showWordbookName,
  onLookupWord,
  onRemoveWord,
  onUpdateStar
}: WordbookCompactListProps): React.JSX.Element {
  const rows = table.getRowModel().rows

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <LoaderCircle className="mr-2 size-4 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{loadingMessage}</p>
      </div>
    )
  }

  if (isError) {
    return <p className="p-6 text-sm text-destructive">加载失败。</p>
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        {emptyMessage}
      </div>
    )
  }

  const activeSort = table.getState().sorting[0]
  const activeSortOption = compactSortOptions.find((option) => option.id === activeSort?.id)
  const activeSortLabel = activeSortOption
    ? `${activeSortOption.label}${activeSort?.desc ? '（降序）' : '（升序）'}`
    : '排序'

  const setSorting = (id: CompactSortColumn): void => {
    const isActive = activeSort?.id === id
    table.setSorting([{ id, desc: isActive ? !activeSort.desc : false }])
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-1 py-2">
        <label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <input
            aria-label="全选当前页单词"
            checked={table.getIsAllPageRowsSelected()}
            className="size-4 shrink-0 accent-primary"
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            ref={(node) => {
              if (node) node.indeterminate = table.getIsSomePageRowsSelected()
            }}
            type="checkbox"
          />
          全选当前页
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="shrink-0" size="sm" type="button" variant="ghost">
              <ArrowUpDown />
              {activeSortLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>排序方式</DropdownMenuLabel>
            {compactSortOptions.map((option) => {
              const isActive = activeSort?.id === option.id
              return (
                <DropdownMenuItem key={option.id} onSelect={() => setSorting(option.id)}>
                  <span className="w-3 text-center" aria-hidden="true">
                    {isActive ? (activeSort?.desc ? '↓' : '↑') : ''}
                  </span>
                  {option.label}
                </DropdownMenuItem>
              )
            })}
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

      <div className="min-h-0 flex-1 divide-y overflow-auto">
        {rows.map((row) => {
          const { createdAt, star, translation, word, wordbookName } = row.original
          return (
            <div className={row.getIsSelected() ? 'bg-muted/50' : undefined} key={row.id}>
              <div className="flex items-start gap-3 px-1 py-3">
                <input
                  aria-label={`选择 ${word}`}
                  checked={row.getIsSelected()}
                  className="mt-1 size-4 shrink-0 accent-primary"
                  disabled={!row.getCanSelect()}
                  onChange={row.getToggleSelectedHandler()}
                  type="checkbox"
                />
                <div className="min-w-0 flex-1">
                  <button
                    className="block max-w-full truncate text-left font-medium hover:text-primary"
                    onClick={() => onLookupWord(word)}
                    title={`查词：${word}`}
                    type="button"
                  >
                    {word}
                  </button>
                  <p
                    className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground"
                    title={translation ?? undefined}
                  >
                    {translation ?? '—'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    {showWordbookName && <span className="max-w-32 truncate">{wordbookName}</span>}
                    <time dateTime={createdAt}>{formatTime(createdAt)}</time>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StarRating onChange={(nextStar) => onUpdateStar(word, nextStar)} rating={star} />
                  <div className="flex items-center gap-0.5">
                    <Button
                      onClick={() => onLookupWord(word)}
                      size="icon"
                      title="查词"
                      type="button"
                      variant="ghost"
                    >
                      <Search className="size-4 text-muted-foreground" />
                    </Button>
                    <Button
                      disabled={isRemoving}
                      onClick={() => onRemoveWord(word)}
                      size="icon"
                      title="移出生词本"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WordbookWords = (): React.JSX.Element => {
  const { wordbookId } = useParams<{ wordbookId?: string }>()

  // ---------- pagination & filter ----------
  const PAGE_SIZE = 25
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')

  // Debounce keyword (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 300)
    return () => clearTimeout(timer)
  }, [keyword])

  // Reset page to 1 when wordbookId or keyword changes
  useEffect(() => {
    setPage(1)
  }, [wordbookId, debouncedKeyword])

  const hasKeyword = debouncedKeyword.trim().length > 0

  // ---------- data ----------
  const listResult = useWordbookWords(wordbookId, page, PAGE_SIZE, !hasKeyword)
  const filterResult = useFilterWords(debouncedKeyword, wordbookId, page, PAGE_SIZE)

  const activeResult = hasKeyword ? filterResult : listResult
  const words: WordbookWordItem[] = activeResult.data?.items ?? []
  const total = activeResult.data?.total ?? 0
  const isWordsLoading = activeResult.isLoading
  const isWordsError = activeResult.isError

  const { data: wordbooks = [] } = useWordbooks()
  const { data: exportStatus } = useWordbookExportStatus()
  const moveWords = useMoveWordbookWords()
  const exportWordbooks = useExportWordbooks()
  const importWordbookWords = useImportWordbookWords()
  const deleteWords = useDeleteWords()
  const { mutate: updateStarMutate } = useUpdateStar()
  const { mutate: unStarMutate, isPending: isRemovingWord } = useUnStarWord()
  const navigate = useNavigate()
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)

  const lookupWord = useCallback(
    (word: string) => {
      setSearchQuery(word)
      navigate(`/search/${encodeURIComponent(word)}`)
    },
    [navigate, setSearchQuery]
  )

  const updateWordStar = useCallback(
    (word: string, star: number) => updateStarMutate({ word, star }),
    [updateStarMutate]
  )

  const removeWord = useCallback((word: string) => unStarMutate(word), [unStarMutate])

  // ---------- table state ----------
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [sorting, setSorting] = useState<SortingState>([])
  const [wordsContainerRef, wordsContainerWidth] = useElementWidth()
  const isCompactList = wordsContainerWidth !== null && wordsContainerWidth < 720
  const isCondensedTable = wordsContainerWidth !== null && wordsContainerWidth < 960

  const columnVisibility = useMemo<VisibilityState>(
    () => ({
      createdAt: !isCondensedTable,
      wordbookName: wordbookId ? !isCondensedTable : true
    }),
    [isCondensedTable, wordbookId]
  )

  const columns = useMemo<ColumnDef<WordbookWordItem>[]>(() => {
    const base: ColumnDef<WordbookWordItem>[] = [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            aria-label="全选单词"
            checked={table.getIsAllPageRowsSelected()}
            className="size-4 accent-primary"
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            ref={(node) => {
              if (node) node.indeterminate = table.getIsSomePageRowsSelected()
            }}
            type="checkbox"
          />
        ),
        cell: ({ row }) => (
          <input
            aria-label={`选择 ${row.original.word}`}
            checked={row.getIsSelected()}
            className="size-4 accent-primary"
            disabled={!row.getCanSelect()}
            onChange={row.getToggleSelectedHandler()}
            type="checkbox"
          />
        )
      },
      {
        accessorKey: 'word',
        header: ({ column }) => (
          <Button
            className="-ml-3"
            onClick={() => column.toggleSorting()}
            size="sm"
            type="button"
            variant="ghost"
          >
            单词
            <ArrowUpDown className="ml-1 size-3.5" />
          </Button>
        ),
        cell: ({ getValue }) => (
          <span className="block truncate font-medium">{getValue<string>()}</span>
        )
      },
      {
        accessorKey: 'wordbookName',
        header: '生词本',
        cell: ({ getValue }) => (
          <span className="block truncate text-muted-foreground">{getValue<string>()}</span>
        )
      },
      {
        accessorKey: 'translation',
        header: '中文释义',
        cell: ({ getValue }) => {
          const translation = getValue<string | null>()
          return (
            <span
              className="block min-w-0 truncate text-muted-foreground"
              title={translation ?? undefined}
            >
              {translation ?? '—'}
            </span>
          )
        }
      },
      {
        accessorKey: 'star',
        header: ({ column }) => (
          <Button
            className="mx-auto"
            onClick={() => column.toggleSorting()}
            size="sm"
            type="button"
            variant="ghost"
          >
            星级
            <ArrowUpDown className="ml-1 size-3.5" />
          </Button>
        ),
        cell: ({ row }) => (
          <StarRating
            onChange={(star) => updateWordStar(row.original.word, star)}
            rating={row.original.star}
          />
        )
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <Button
            className="-ml-3"
            onClick={() => column.toggleSorting()}
            size="sm"
            type="button"
            variant="ghost"
          >
            添加时间
            <ArrowUpDown className="ml-1 size-3.5" />
          </Button>
        ),
        cell: ({ getValue }) => {
          const createdAt = getValue<string>()
          return (
            <time className="text-muted-foreground" dateTime={createdAt}>
              {formatTime(createdAt)}
            </time>
          )
        }
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-0.5">
            <Button
              onClick={() => lookupWord(row.original.word)}
              size="icon"
              title="查词"
              type="button"
              variant="ghost"
            >
              <Search className="size-4 text-muted-foreground" />
            </Button>
            <Button
              disabled={isRemovingWord}
              onClick={() => removeWord(row.original.word)}
              size="icon"
              title="移出生词本"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4 text-muted-foreground" />
            </Button>
          </div>
        ),
        enableSorting: false
      }
    ]

    return base
  }, [isRemovingWord, lookupWord, removeWord, updateWordStar])

  const getRowId = useCallback((row: WordbookWordItem) => row.id, [])

  // Stable references so useReactTable doesn't reconcile state on every render
  const coreRowModel = useMemo(() => getCoreRowModel(), [])
  const sortedRowModel = useMemo(() => getSortedRowModel(), [])
  const tableState = useMemo(
    () => ({ columnVisibility, rowSelection, sorting }),
    [columnVisibility, rowSelection, sorting]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: words,
    columns,
    getCoreRowModel: coreRowModel,
    getSortedRowModel: sortedRowModel,
    getRowId,
    enableRowSelection: true,
    enableSorting: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    state: tableState
  })

  const selectedWordIds = table.getSelectedRowModel().rows.map((row) => row.original.id)

  // ---------- export dialog ----------
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportScope, setExportScope] = useState<ExportScope>('all')
  const [exportWordbookId, setExportWordbookId] = useState('')
  const [exportDirectory, setExportDirectory] = useState('')
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importText, setImportText] = useState('')

  // ---------- toast notifications ----------
  const isExporting = exportStatus?.state === 'exporting'
  const lastToastRef = useRef<{
    exportState?: string
    moveError?: string
  }>({})

  useEffect(() => {
    if (
      moveWords.isError &&
      moveWords.error &&
      moveWords.error.message !== lastToastRef.current.moveError
    ) {
      lastToastRef.current.moveError = moveWords.error.message
      toast.error(moveWords.error.message)
    }
  }, [moveWords.isError, moveWords.error])

  useEffect(() => {
    if (
      exportStatus?.state === 'completed' &&
      exportStatus.destinationPath &&
      exportStatus.state !== lastToastRef.current.exportState
    ) {
      lastToastRef.current.exportState = exportStatus.state
      toast.success('导出完成', { description: exportStatus.destinationPath })
    }
  }, [exportStatus?.state, exportStatus?.destinationPath])

  useEffect(() => {
    if (
      exportStatus?.state === 'error' &&
      exportStatus.error &&
      exportStatus.state !== lastToastRef.current.exportState
    ) {
      lastToastRef.current.exportState = exportStatus.state
      toast.error('导出失败', { description: exportStatus.error })
    }
  }, [exportStatus?.state, exportStatus?.error])

  const selectExportDirectory = async (): Promise<void> => {
    setIsChoosingDirectory(true)
    const path = await window.dictol.wordbooks.selectDirectory()
    if (path) setExportDirectory(path)
    setIsChoosingDirectory(false)
  }

  const submitExport = (): void => {
    if (!exportDirectory) return

    const request =
      exportScope === 'all'
        ? { scope: 'all' as const }
        : exportScope === 'wordbook'
          ? { scope: 'wordbook' as const, wordbookId: exportWordbookId }
          : { scope: 'selected' as const, wordIds: selectedWordIds }

    exportWordbooks.mutate(
      { request, directoryPath: exportDirectory },
      {
        onSuccess: ({ started }) => {
          if (started) setExportDialogOpen(false)
        }
      }
    )
  }

  const submitWordbookImport = (): void => {
    if (!importText.trim()) return

    importWordbookWords.mutate(
      { text: importText, wordbookId },
      {
        onSuccess: (result) => {
          toast.success(`已导入 ${result.imported} 个单词到“${result.wordbookName}”`)
          setImportText('')
          setImportDialogOpen(false)
          setPage(1)
          setRowSelection({})
        }
      }
    )
  }

  // 当前生词本名称
  const activeWordbookName = wordbookId
    ? (wordbooks.find((wb) => wb.id === wordbookId)?.name ?? '生词本')
    : '全部'
  const importTargetName = wordbookId
    ? activeWordbookName
    : (wordbooks.find((wordbook) => wordbook.isDefault)?.name ?? '默认生词本')

  const emptyWordsMessage = (
    <>
      <BookMarked className="mb-3 size-7 text-muted-foreground" />
      <p className="text-sm font-medium">暂无单词</p>
      <p className="mt-1 text-sm text-muted-foreground">查询词条后，可将单词加入默认生词本。</p>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ======== Header ======== */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <p className="mb-2 text-sm font-medium text-primary">生词管理</p>
          <h1 className="text-xl font-semibold tracking-tight">{activeWordbookName}</h1>
        </div>
        <div className="flex justify-between">
          <div className="flex items-center gap-2">
            {/* 批量移动 */}
            {selectedWordIds.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button disabled={moveWords.isPending} type="button" variant="outline">
                    {moveWords.isPending && <LoaderCircle className="animate-spin" />}
                    移动
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>移动到</DropdownMenuLabel>
                  {wordbooks.map((wb) => (
                    <DropdownMenuItem
                      disabled={table
                        .getSelectedRowModel()
                        .rows.every((row) => row.original.wordbookId === wb.id)}
                      key={wb.id}
                      onSelect={() =>
                        moveWords.mutate(
                          {
                            wordIds: selectedWordIds,
                            destinationWordbookId: wb.id
                          },
                          { onSuccess: () => setRowSelection({}) }
                        )
                      }
                    >
                      {wb.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* 批量删除 */}
            {selectedWordIds.length > 0 && (
              <Button
                disabled={deleteWords.isPending}
                onClick={() =>
                  deleteWords.mutate(
                    table.getSelectedRowModel().rows.map((r) => r.original.word),
                    { onSuccess: () => setRowSelection({}) }
                  )
                }
                type="button"
                variant="outline"
              >
                {deleteWords.isPending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                删除
              </Button>
            )}
            {/* 导入 */}
            <Dialog
              onOpenChange={(open) => {
                if (importWordbookWords.isPending) return
                if (open) {
                  setImportText('')
                  importWordbookWords.reset()
                }
                setImportDialogOpen(open)
              }}
              open={importDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  disabled={importWordbookWords.isPending}
                  type="button"
                  variant="outline"
                  size="sm"
                >
                  <Upload />
                  导入
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>导入单词</DialogTitle>
                  <DialogDescription>
                    每行输入一个单词，将导入到“{importTargetName}”生词本。
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <label className="grid gap-2 text-sm font-medium" htmlFor="wordbook-import-words">
                    单词列表
                    <textarea
                      autoFocus
                      className="min-h-56 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={importWordbookWords.isPending}
                      id="wordbook-import-words"
                      onChange={(event) => setImportText(event.target.value)}
                      placeholder={'running\nbeautiful\nexample'}
                      spellCheck={false}
                      value={importText}
                    />
                  </label>
                  {importWordbookWords.isError && (
                    <p className="text-sm text-destructive">{importWordbookWords.error.message}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    disabled={!importText.trim() || importWordbookWords.isPending}
                    onClick={submitWordbookImport}
                    type="button"
                  >
                    {importWordbookWords.isPending && <LoaderCircle className="animate-spin" />}
                    {importWordbookWords.isPending ? '正在导入' : '导入'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {/* 导出 */}
            <Dialog
              onOpenChange={(open) => {
                if (open) {
                  setExportScope('all')
                  setExportWordbookId('')
                  setExportDirectory('')
                }
                setExportDialogOpen(open)
              }}
              open={exportDialogOpen}
            >
              <DialogTrigger asChild>
                <Button disabled={isExporting} type="button" variant="outline" size="sm">
                  {isExporting ? <LoaderCircle className="animate-spin" /> : <Download />}
                  {isExporting ? '正在导出' : '导出'}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>导出生词本</DialogTitle>
                  <DialogDescription>
                    选择导出范围和保存目录，然后点击“导出”开始。
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid gap-3 text-sm border rounded-lg p-3">
                    <label className="flex items-center gap-2">
                      <input
                        checked={exportScope === 'all'}
                        className="accent-primary"
                        name="export-scope"
                        onChange={() => setExportScope('all')}
                        type="radio"
                      />
                      导出全部
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        checked={exportScope === 'wordbook'}
                        className="accent-primary"
                        disabled={wordbooks.length === 0}
                        name="export-scope"
                        onChange={() => setExportScope('wordbook')}
                        type="radio"
                      />
                      导出指定生词本
                    </label>
                    {exportScope === 'wordbook' && (
                      <select
                        className="ml-5 h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        onChange={(event) => setExportWordbookId(event.target.value)}
                        value={exportWordbookId}
                      >
                        <option disabled value="">
                          选择生词本…
                        </option>
                        {wordbooks.map((wb) => (
                          <option key={wb.id} value={wb.id}>
                            {wb.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="flex items-center gap-2">
                      <input
                        checked={exportScope === 'selected'}
                        className="accent-primary"
                        disabled={selectedWordIds.length === 0}
                        name="export-scope"
                        onChange={() => setExportScope('selected')}
                        type="radio"
                      />
                      导出所选（{selectedWordIds.length} 个单词）
                    </label>
                  </div>

                  {/* 选择导出目录 */}
                  <div className="flex items-center gap-3 rounded-lg border border-input bg-background p-3">
                    <Button
                      disabled={isChoosingDirectory}
                      onClick={selectExportDirectory}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {isChoosingDirectory && <LoaderCircle className="animate-spin" />}
                      选择导出目录
                    </Button>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {exportDirectory || '尚未选择目录'}
                    </span>
                  </div>

                  {exportWordbooks.isError && (
                    <p className="text-sm text-destructive">{exportWordbooks.error.message}</p>
                  )}
                  <DialogFooter>
                    <Button
                      disabled={
                        !exportDirectory ||
                        exportWordbooks.isPending ||
                        (exportScope === 'wordbook' && !exportWordbookId) ||
                        (exportScope === 'selected' && selectedWordIds.length === 0)
                      }
                      onClick={submitExport}
                      type="button"
                    >
                      {exportWordbooks.isPending && <LoaderCircle className="animate-spin" />}
                      导出
                    </Button>
                  </DialogFooter>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle>生词列表</CardTitle>
              <CardDescription>管理生词本的单词、星级评分</CardDescription>
            </div>
            <div className="min-w-40 flex-1 sm:max-w-48">
              <Input
                className="h-8 w-full bg-transparent"
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="过滤单词…"
                value={keyword}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col pt-0">
          <div className="flex min-h-0 flex-1 flex-col" ref={wordsContainerRef}>
            {isCompactList ? (
              <WordbookCompactList
                emptyMessage={emptyWordsMessage}
                isError={isWordsError}
                isLoading={isWordsLoading}
                isRemoving={isRemovingWord}
                loadingMessage="正在加载单词…"
                onLookupWord={lookupWord}
                onRemoveWord={removeWord}
                onUpdateStar={updateWordStar}
                showWordbookName={!wordbookId}
                table={table}
              />
            ) : (
              <DataTable
                columnClassName={columnClass}
                columnsCount={table.getVisibleLeafColumns().length}
                emptyMessage={emptyWordsMessage}
                isError={isWordsError}
                isLoading={isWordsLoading}
                loadingMessage="正在加载单词…"
                table={table}
              />
            )}
            {total > 0 && (
              <DataTablePagination
                onPageChange={setPage}
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
