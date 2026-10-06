import { NotebookPen, Search, Trash2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { StarRating } from '@/components/ui/star-rating'
import { WordbookTagEditor } from '@/components/wordbook/WordbookTagControls'
import { formatTime } from '@/lib/utils'
import { type WordbookTag } from '@/hooks/use-wordbook-tags'
import { type WordbookWordItem } from '@/hooks/use-wordbooks'

export function createWordbookColumns({
  tags,
  showWordbookName,
  onLookup,
  onOpenSearchExplanation,
  onNotes,
  onRemove,
  onUpdateStar,
  removing
}: {
  tags: WordbookTag[]
  showWordbookName: boolean
  onLookup: (word: string) => void
  onOpenSearchExplanation: (word: string) => void
  onNotes: (word: string) => void
  onRemove: (word: string) => void
  onUpdateStar: (word: string, star: number) => void
  removing: boolean
}): ColumnDef<WordbookWordItem>[] {
  return [
    {
      id: 'select',
      size: 40,
      enableSorting: false,
      header: ({ table }) => (
        <input
          aria-label="全选当前页单词"
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
          onChange={row.getToggleSelectedHandler()}
          type="checkbox"
        />
      )
    },
    {
      accessorKey: 'word',
      size: 130,
      header: '单词',
      cell: ({ row }) => (
        <div className="min-w-0">
          <button
            className="block max-w-full truncate text-left font-semibold hover:text-primary"
            onClick={() => onLookup(row.original.word)}
            type="button"
          >
            {row.original.word}
          </button>
          {row.original.phonetic && (
            <span className="block truncate text-xs text-muted-foreground">
              /{row.original.phonetic}/
            </span>
          )}
        </div>
      )
    },
    {
      accessorKey: 'translation',
      size: 180,
      header: '释义',
      enableSorting: false,
      cell: ({ row }) => (
        <p className="truncate text-muted-foreground" title={row.original.translation ?? ''}>
          {row.original.translation || '—'}
        </p>
      )
    },
    ...(showWordbookName
      ? ([
          {
            accessorKey: 'wordbookName',
            size: 72,
            header: '生词本',
            enableSorting: false,
            cell: ({ row }) => (
              <span className="truncate text-muted-foreground" title={row.original.wordbookName}>
                {row.original.wordbookName}
              </span>
            )
          }
        ] satisfies ColumnDef<WordbookWordItem>[])
      : []),
    {
      id: 'tags',
      size: 140,
      header: '标签',
      enableSorting: false,
      cell: ({ row }) => <WordbookTagEditor allTags={tags} word={row.original} />
    },
    {
      accessorKey: 'star',
      size: 110,
      header: '星级',
      cell: ({ row }) => (
        <StarRating
          onChange={(star) => onUpdateStar(row.original.word, star)}
          rating={row.original.star}
        />
      )
    },
    {
      accessorKey: 'createdAt',
      size: 100,
      header: '添加时间',
      cell: ({ row }) => (
        <time className="truncate text-xs text-muted-foreground" dateTime={row.original.createdAt}>
          {formatTime(row.original.createdAt)}
        </time>
      )
    },
    {
      id: 'actions',
      size: 100,
      enableSorting: false,
      header: '操作',
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button
            aria-label={`AI 查词 ${row.original.word}`}
            className="size-7"
            onClick={() => onOpenSearchExplanation(row.original.word)}
            size="icon"
            title="AI 查词"
            type="button"
            variant="ghost"
          >
            <Search className="size-3.5" />
          </Button>
          <Button
            aria-label={`查看 ${row.original.word} 的笔记`}
            className="size-7"
            onClick={() => onNotes(row.original.word)}
            size="icon"
            title="笔记"
            type="button"
            variant="ghost"
          >
            <NotebookPen className="size-3.5" />
          </Button>
          <Button
            aria-label={`从生词本移除 ${row.original.word}`}
            className="size-7"
            disabled={removing}
            onClick={() => onRemove(row.original.word)}
            size="icon"
            title="移出"
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )
    }
  ]
}
