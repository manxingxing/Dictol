import { useEffect, useRef, useState } from 'react'
import { BookOpen, LoaderCircle, Search } from 'lucide-react'
import useDebounce from 'react-use/lib/useDebounce'

import { ExcerptNoteRecord } from '@/components/dictionaryNote/ExcerptNoteRecord'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTablePagination } from '@/components/data-table-pagination'
import {
  useSearchDictionaryNotes,
  useSearchDictionaryNotesByWord
} from '@/hooks/use-dictionary-note'
import { formatTime } from '@/lib/utils'

const PAGE_SIZE = 25

export function ExcerptsPage(): React.JSX.Element {
  const pageRef = useRef<HTMLDivElement>(null)
  const [searchText, setSearchText] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [view, setView] = useState<'records' | 'words'>('records')

  useDebounce(
    () => {
      setQuery(searchText.trim())
      setPage(1)
    },
    250,
    [searchText]
  )

  const notes = useSearchDictionaryNotes(query, page, PAGE_SIZE, view === 'records')
  const wordGroups = useSearchDictionaryNotesByWord(query, page, PAGE_SIZE, view === 'words')

  const openSearchExplanation = (term: string): void => {
    window.dictol.selectionExplanation.show(term)
  }

  const handlePageChange = (nextPage: number): void => {
    setPage(nextPage)
    pageRef.current?.parentElement?.scrollTo({ top: 0 })
  }

  const items = notes.data?.items ?? []
  const total = notes.data?.total ?? 0
  const groups = wordGroups.data?.items ?? []
  const activeQuery = view === 'records' ? notes : wordGroups
  const isLoading = activeQuery.isLoading
  const isError = activeQuery.isError
  const error = activeQuery.error
  const visibleTotal = view === 'records' ? total : (wordGroups.data?.total ?? 0)

  useEffect(() => {
    if (!activeQuery.isSuccess || activeQuery.isFetching) return

    const lastPage = Math.max(1, Math.ceil(visibleTotal / PAGE_SIZE))
    // The refreshed total is the source of truth for whether this page still exists.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (page > lastPage) setPage(lastPage)
  }, [activeQuery.isSuccess, activeQuery.isFetching, visibleTotal, page])

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5 p-5 md:p-8"
      ref={pageRef}
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-medium text-primary">阅读积累</p>
          <h1 className="text-2xl font-semibold tracking-tight">摘抄与笔记</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按单词、原文或笔记内容查找已保存的语境。
          </p>
        </div>
        <div className="flex w-full items-center gap-3">
          <Tabs
            className="w-auto shrink-0"
            onValueChange={(value) => {
              if (value === 'records' || value === 'words') {
                setView(value)
                setPage(1)
              }
            }}
            value={view}
          >
            <TabsList aria-label="浏览方式" className="h-9">
              <TabsTrigger className="h-7 px-3 text-sm" value="records">
                按时间
              </TabsTrigger>
              <TabsTrigger className="h-7 px-3 text-sm" value="words">
                按单词
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative ml-auto max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索摘抄与笔记"
              className="h-9 pl-9"
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索摘抄或笔记"
              type="search"
              value={searchText}
            />
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="flex min-h-64 flex-1 items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          正在加载摘抄…
        </div>
      ) : isError ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-destructive">摘抄加载失败：{error?.message}</p>
          <Button
            onClick={() => void (view === 'records' ? notes.refetch() : wordGroups.refetch())}
            size="sm"
            type="button"
            variant="outline"
          >
            重试
          </Button>
        </div>
      ) : visibleTotal ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {view === 'records'
              ? items.map((note) => (
                  <ExcerptNoteRecord
                    key={note.id}
                    note={note}
                    onOpenSearchExplanation={openSearchExplanation}
                    variant="timeline"
                  />
                ))
              : groups.map((group) => (
                  <article
                    className="rounded-xl border border-border bg-card p-3 pb-1"
                    key={group.normalizedTerm}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2">
                      <button
                        className="rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                        onClick={() => openSearchExplanation(group.term)}
                        title={`查词：${group.term}`}
                        type="button"
                      >
                        {group.term}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {group.notes.length} 条记录 · 最近 {formatTime(group.latestCreatedAt)}
                      </span>
                    </div>
                    {group.notes.map((note, index) => (
                      <ExcerptNoteRecord
                        key={`${group.normalizedTerm}-${note.id}`}
                        note={note}
                        separator={index > 0}
                        variant="word-group"
                      />
                    ))}
                  </article>
                ))}
          </div>
          <DataTablePagination
            onPageChange={handlePageChange}
            page={page}
            pageSize={PAGE_SIZE}
            total={visibleTotal}
          />
        </>
      ) : (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center">
          <BookOpen className="mb-3 size-6 text-muted-foreground" />
          <p className="font-medium">{query ? '没有匹配的摘抄或笔记' : '还没有摘抄或笔记'}</p>
          <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
            {query
              ? '试试其他单词、原文片段或笔记内容。'
              : '在词典释义中摘抄句子，或在单词笔记中添加独立笔记后，会集中显示在这里。'}
          </p>
        </div>
      )}
    </div>
  )
}
