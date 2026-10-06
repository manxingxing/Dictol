import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState
} from '@tanstack/react-table'
import {
  BookMarked,
  Check,
  ChevronDown,
  Download,
  LoaderCircle,
  Plus,
  Tags,
  Trash2
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

import {
  useExportWordbooks,
  useMoveWordbookWords,
  useUnStarWord,
  useUpdateStar,
  useWordbookExportStatus,
  useWordbookWords,
  useWordbooks,
  useDeleteWords,
  type WordbookWordItem
} from '@/hooks/use-wordbooks'
import {
  useAddTagToWords,
  useRemoveTagFromWords,
  useWordbookTags,
  type WordbookTag
} from '@/hooks/use-wordbook-tags'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'

import { useAppStore } from '@/stores/app-store'
import {
  WordbookBulkTagPopover,
  WordbookTagManager
} from '@/components/wordbook/WordbookTagControls'
import { WordbookWordsTable } from '@/pages/wordbook/WordbookWordsTable'
import { createWordbookColumns } from '@/pages/wordbook/wordbook-columns'
import { ImportWordbookWordsDialog } from '@/components/wordbook/ImportWordbookWordsDialog'
import useDebounce from 'react-use/lib/useDebounce'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportScope = 'all' | 'wordbook' | 'selected'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WordbookWords = (): React.JSX.Element => {
  const { onCreateWordbook, wordbookStatus } = useOutletContext<{
    onCreateWordbook: () => void
    wordbookStatus: ReactNode
  }>()
  const { wordbookId } = useParams<{ wordbookId?: string }>()

  // ---------- pagination & filter ----------
  const PAGE_SIZE = 25
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null | undefined>(undefined)

  // Debounce keyword (300ms)
  useDebounce(() => setDebouncedKeyword(keyword), 300, [keyword])

  // Reset page to 1 when wordbookId or keyword changes
  useEffect(() => {
    setPage(1)
  }, [wordbookId, debouncedKeyword, tagFilter])

  // ---------- data ----------
  const wordsResult = useWordbookWords(debouncedKeyword, wordbookId, page, PAGE_SIZE, tagFilter)
  const words: WordbookWordItem[] = useMemo(
    () => wordsResult.data?.items ?? [],
    [wordsResult.data?.items]
  )
  const total = wordsResult.data?.total ?? 0
  const isWordsLoading = wordsResult.isLoading
  const isWordsError = wordsResult.isError

  const { data: wordbooks = [] } = useWordbooks()
  const tagsQuery = useWordbookTags()
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data])
  useEffect(() => {
    if (
      !tagsQuery.isLoading &&
      typeof tagFilter === 'string' &&
      !tags.some((tag) => tag.id === tagFilter)
    ) {
      setTagFilter(undefined)
    }
  }, [tagFilter, tags, tagsQuery.isLoading])
  const { data: exportStatus } = useWordbookExportStatus()
  const moveWords = useMoveWordbookWords()
  const exportWordbooks = useExportWordbooks()
  const deleteWords = useDeleteWords()
  const addTagToWords = useAddTagToWords()
  const removeTagFromWords = useRemoveTagFromWords()
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

  const openSearchExplanation = useCallback((word: string) => {
    window.dictol.selectionExplanation.show(word)
  }, [])

  const updateWordStar = useCallback(
    (word: string, star: number) => updateStarMutate({ word, star }),
    [updateStarMutate]
  )

  const removeWord = useCallback((word: string) => unStarMutate(word), [unStarMutate])

  // ---------- table state ----------
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [sorting, setSorting] = useState<SortingState>([])

  useEffect(() => {
    setRowSelection({})
  }, [wordbookId, debouncedKeyword, tagFilter])

  const columns = useMemo<ColumnDef<WordbookWordItem>[]>(
    () =>
      createWordbookColumns({
        tags,
        showWordbookName: !wordbookId,
        onLookup: lookupWord,
        onOpenSearchExplanation: openSearchExplanation,
        onRemove: removeWord,
        onUpdateStar: updateWordStar,
        removing: isRemovingWord
      }),
    [
      isRemovingWord,
      lookupWord,
      openSearchExplanation,
      removeWord,
      wordbookId,
      tags,
      updateWordStar
    ]
  )

  const getRowId = useCallback((row: WordbookWordItem) => row.id, [])

  // Stable references so useReactTable doesn't reconcile state on every render
  const coreRowModel = useMemo(() => getCoreRowModel(), [])
  const sortedRowModel = useMemo(() => getSortedRowModel(), [])
  const tableState = useMemo(() => ({ rowSelection, sorting }), [rowSelection, sorting])

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
    initialState: {
      columnPinning: { left: ['select', 'word'], right: ['actions'] }
    },
    state: tableState
  })

  const selectedWords = table.getSelectedRowModel().rows.map((row) => row.original)
  const selectedWordIds = selectedWords.map((word) => word.id)

  const handleBulkTagAction = useCallback(
    (action: 'add' | 'remove', tag: WordbookTag) => {
      if (action === 'add') {
        addTagToWords.mutate(
          { wordIds: selectedWordIds, tagId: tag.id },
          {
            onSuccess: () => toast.success(`已为所选单词添加“${tag.name}”`),
            onError: (error) => toast.error('批量添加标签失败', { description: error.message })
          }
        )
        return
      }

      removeTagFromWords.mutate(
        { wordIds: selectedWordIds, tagId: tag.id },
        {
          onSuccess: () => toast.success(`已从所选单词移除“${tag.name}”`),
          onError: (error) => toast.error('批量移除标签失败', { description: error.message })
        }
      )
    },
    [addTagToWords.mutate, removeTagFromWords.mutate, selectedWordIds]
  )

  // ---------- export dialog ----------
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportScope, setExportScope] = useState<ExportScope>('all')
  const [exportWordbookId, setExportWordbookId] = useState('')
  const [exportDirectory, setExportDirectory] = useState('')
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false)

  // ---------- move notifications ----------
  const isExporting = exportStatus?.state === 'exporting'

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

  // 当前生词本名称
  const activeWordbookName = wordbookId
    ? (wordbooks.find((wb) => wb.id === wordbookId)?.name ?? '生词本')
    : '全部'
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
        <div className="min-w-0">
          <p className="mb-2 text-sm font-medium text-primary">生词管理</p>
          <h1 className="text-xl font-semibold tracking-tight">{activeWordbookName}</h1>
        </div>
        <div className="min-w-0 max-w-full">
          <div className="flex flex-wrap items-center gap-2">
            <WordbookTagManager tags={tags} />
            <ImportWordbookWordsDialog
              onImported={() => {
                setPage(1)
                setRowSelection({})
              }}
              wordbookId={wordbookId}
            />
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
          <div className="lg:hidden">{wordbookStatus}</div>
        </div>
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-border pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="lg:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="切换生词本"
                    className="h-8 max-w-48"
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <span className="truncate">{activeWordbookName}</span>
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>选择生词本</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => navigate('/wordbooks')}>
                    <span className="flex size-4 items-center justify-center">
                      {!wordbookId && <Check className="size-4" />}
                    </span>
                    全部
                  </DropdownMenuItem>
                  {wordbooks.map((wordbook) => (
                    <DropdownMenuItem
                      key={wordbook.id}
                      onSelect={() => navigate(`/wordbooks/${wordbook.id}`)}
                    >
                      <span className="flex size-4 items-center justify-center">
                        {wordbookId === wordbook.id && <Check className="size-4" />}
                      </span>
                      {wordbook.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onCreateWordbook}>
                    <Plus className="size-4" />
                    新建生词本
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="min-w-40 max-w-64 flex-1">
              <Input
                className="h-8 w-full bg-transparent"
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="过滤单词…"
                value={keyword}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-8 shrink-0" size="sm" type="button" variant="outline">
                  <Tags />
                  {tagFilter === undefined
                    ? '全部标签'
                    : tagFilter === null
                      ? '未分类'
                      : (tags.find((tag) => tag.id === tagFilter)?.name ?? '标签筛选')}
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setTagFilter(undefined)}>
                  <span className="w-4">
                    {tagFilter === undefined && <Check className="size-4" />}
                  </span>
                  全部单词
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTagFilter(null)}>
                  <span className="w-4">{tagFilter === null && <Check className="size-4" />}</span>
                  未分类
                </DropdownMenuItem>
                {tags.length > 0 && <DropdownMenuSeparator />}
                {tags.map((tag) => (
                  <DropdownMenuItem key={tag.id} onSelect={() => setTagFilter(tag.id)}>
                    <span className="w-4">
                      {tagFilter === tag.id && <Check className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    <span className="text-xs text-muted-foreground">{tag.wordCount}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div
              aria-label={`所选单词操作，共 ${selectedWordIds.length} 个`}
              className="ml-auto flex max-w-full items-center gap-2 overflow-x-auto"
              role="toolbar"
            >
              <WordbookBulkTagPopover
                disabled={selectedWordIds.length === 0}
                onAction={handleBulkTagAction}
                pending={addTagToWords.isPending || removeTagFromWords.isPending}
                tags={tags}
                words={selectedWords}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    disabled={selectedWordIds.length === 0 || moveWords.isPending}
                    type="button"
                    variant="outline"
                    size="sm"
                  >
                    {moveWords.isPending && <LoaderCircle className="animate-spin" />}
                    移动
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
                          {
                            onSuccess: () => setRowSelection({}),
                            onError: (error) => toast.error(error.message)
                          }
                        )
                      }
                    >
                      {wb.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                aria-label="删除所选单词"
                disabled={selectedWordIds.length === 0 || deleteWords.isPending}
                onClick={() =>
                  deleteWords.mutate(
                    table.getSelectedRowModel().rows.map((row) => row.original.word),
                    { onSuccess: () => setRowSelection({}) }
                  )
                }
                type="button"
                variant="outline"
                size="sm"
              >
                {deleteWords.isPending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              </Button>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col pt-3">
          <WordbookWordsTable
            empty={emptyWordsMessage}
            error={isWordsError}
            loading={isWordsLoading}
            onPageChange={setPage}
            page={page}
            pageSize={PAGE_SIZE}
            table={table}
            total={total}
          />
        </div>
      </section>
    </div>
  )
}
