import { useState } from 'react'
import { Check, ChevronDown, Plus, SaveCheck, Tags, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  useCreateWordbookTag,
  useDeleteWordbookTag,
  useRenameWordbookTag,
  useSetWordTags,
  type WordbookTag
} from '@/hooks/use-wordbook-tags'
import { type WordbookWordItem } from '@/hooks/use-wordbooks'

export function WordbookTagManager({ tags }: { tags: WordbookTag[] }): React.JSX.Element {
  const [name, setName] = useState('')
  const createTag = useCreateWordbookTag()

  const submit = (): void => {
    createTag.mutate(name, {
      onSuccess: () => {
        setName('')
        toast.success('标签已创建')
      },
      onError: (error) => toast.error('创建标签失败', { description: error.message })
    })
  }

  return (
    <Dialog>
      <DialogTrigger>
        <Button size="sm" type="button" variant="outline">
          <Tags />
          标签管理
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>管理标签</DialogTitle>
          <DialogDescription>
            标签可在所有生词本中复用。删除标签会解除它与单词的关联。
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            aria-label="新标签名称"
            maxLength={50}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim() && !createTag.isPending) submit()
            }}
            placeholder="新标签名称"
            value={name}
          />
          <Button
            disabled={!name.trim() || createTag.isPending}
            onClick={submit}
            type="button"
          >
            <Plus />
            新建
          </Button>
        </div>
        {createTag.isError && <p className="text-sm text-destructive">{createTag.error.message}</p>}
        <div className="max-h-80 divide-y overflow-auto rounded-md border">
          {tags.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">还没有标签</p>
          ) : (
            tags.map((tag) => <TagManagementRow key={tag.id} tag={tag} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function WordbookBulkTagPopover({
  tags,
  words,
  disabled,
  pending,
  onAction
}: {
  tags: WordbookTag[]
  words: WordbookWordItem[]
  disabled: boolean
  pending: boolean
  onAction: (action: 'add' | 'remove', tag: WordbookTag) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<'add' | 'remove'>('add')
  const [search, setSearch] = useState('')
  const tagCounts = new Map<string, number>()

  for (const word of words) {
    for (const tag of word.tags) tagCounts.set(tag.id, (tagCounts.get(tag.id) ?? 0) + 1)
  }

  const matchingTags = tags.filter((tag) => {
    const count = tagCounts.get(tag.id) ?? 0
    const applies = action === 'add' ? count < words.length : count > 0
    return applies && tag.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  })

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setSearch('')
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          disabled={disabled || pending || words.length === 0 || tags.length === 0}
          size="sm"
          type="button"
          variant="outline"
        >
          <Tags />
          标签
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0" side="top">
        <Input
          autoFocus
          className="h-9 rounded-t-md rounded-b-none border-0 border-b shadow-none focus-visible:ring-0"
          onChange={(event) => setSearch(event.target.value)}
          placeholder={action === 'add' ? '搜索可添加的标签…' : '搜索可移除的标签…'}
          value={search}
        />
        <div aria-label="标签操作" className="grid grid-cols-2 gap-1 border-b p-1" role="group">
          <Button
            aria-pressed={action === 'add'}
            className={`h-7 ${action === 'add' ? 'bg-muted font-medium' : ''}`}
            onClick={() => setAction('add')}
            size="sm"
            type="button"
            variant="ghost"
          >
            添加
          </Button>
          <Button
            aria-pressed={action === 'remove'}
            className={`h-7 ${action === 'remove' ? 'bg-muted font-medium' : ''}`}
            onClick={() => setAction('remove')}
            size="sm"
            type="button"
            variant="ghost"
          >
            移除
          </Button>
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {matchingTags.length > 0 ? (
            matchingTags.map((tag) => (
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                disabled={pending}
                key={tag.id}
                onClick={() => {
                  onAction(action, tag)
                  setOpen(false)
                }}
                type="button"
              >
                {action === 'add' ? (
                  <Plus className="size-4 shrink-0" />
                ) : (
                  <Trash2 className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {tagCounts.get(tag.id) ?? 0}/{words.length}
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {search.trim()
                ? '没有匹配的标签'
                : action === 'add'
                  ? '所选单词已拥有全部标签'
                  : '所选单词没有可移除的标签'}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TagManagementRow({ tag }: { tag: WordbookTag }): React.JSX.Element {
  const [name, setName] = useState(tag.name)
  const renameTag = useRenameWordbookTag()
  const deleteTag = useDeleteWordbookTag()
  const changed = name.trim() !== tag.name

  const submitRenameTag = (): void => {
    renameTag.mutate(
      { tagId: tag.id, name },
      {
        onError: (error) => toast.error('更新失败', { description: error.message }),
        onSuccess: () => toast.success(`标签已更新为「${name}」`)
      }
    )
  }

  return (
    <div className="flex items-center gap-2 p-2">
      <Input
        aria-label={`重命名标签 ${tag.name}`}
        maxLength={50}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && changed && name.trim()) submitRenameTag()
        }}
        value={name}
      />
      <Button
        aria-label={`保存标签 ${tag.name}`}
        disabled={!changed || !name.trim() || renameTag.isPending}
        onClick={submitRenameTag}
        size="icon"
        type="button"
        variant="ghost"
      >
        <SaveCheck />
      </Button>
      <Button
        aria-label={`删除标签 ${tag.name}`}
        disabled={deleteTag.isPending}
        onClick={() =>
          deleteTag.mutate(tag.id, {
            onSuccess: () => toast.success(`已删除标签“${tag.name}”`),
            onError: (error) => toast.error('删除标签失败', { description: error.message })
          })
        }
        size="icon"
        type="button"
        variant="ghost"
      >
        <Trash2 className="text-muted-foreground" />
      </Button>
    </div>
  )
}

export function WordbookTagEditor({
  word,
  allTags
}: {
  word: WordbookWordItem
  allTags: WordbookTag[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const createTag = useCreateWordbookTag()
  const setWordTags = useSetWordTags()
  const selectedIds = new Set(word.tags.map((tag) => tag.id))
  const matchingTags = allTags.filter((tag) =>
    tag.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  )
  const canCreate =
    search.trim().length > 0 &&
    !allTags.some((tag) => tag.name.toLocaleLowerCase() === search.trim().toLocaleLowerCase())

  const toggleTag = (tagId: string): void => {
    const nextIds = selectedIds.has(tagId)
      ? word.tags.filter((tag) => tag.id !== tagId).map((tag) => tag.id)
      : [...word.tags.map((tag) => tag.id), tagId]
    setWordTags.mutate(
      { wordId: word.id, tagIds: nextIds },
      { onError: (error) => toast.error('更新标签失败', { description: error.message }) }
    )
  }

  const createAndAssign = (): void => {
    createTag.mutate(search.trim(), {
      onSuccess: (tag) => {
        setWordTags.mutate(
          { wordId: word.id, tagIds: [...word.tags.map((item) => item.id), tag.id] },
          {
            onSuccess: () => {
              setSearch('')
              toast.success(`已创建并添加标签“${tag.name}”`)
            },
            onError: (error) =>
              toast.error('标签已创建，但添加失败', { description: error.message })
          }
        )
      },
      onError: (error) => toast.error('创建标签失败', { description: error.message })
    })
  }

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setSearch('')
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={`编辑 ${word.word} 的标签`}
          className="h-auto min-h-7 max-w-full justify-start px-1 py-1"
          size="sm"
          type="button"
          variant="ghost"
        >
          {word.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {word.tags.slice(0, 3).map((tag) => (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs" key={tag.id}>
                  {tag.name}
                </span>
              ))}
              {word.tags.length > 3 && (
                <span className="text-xs text-muted-foreground">+{word.tags.length - 3}</span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Tags className="size-3.5" />
              添加标签
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-b p-2">
          <Input
            autoFocus
            className="h-8"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索或新建标签"
            value={search}
          />
        </div>
        <div className="max-h-56 overflow-auto p-1">
          {matchingTags.map((tag) => (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              disabled={setWordTags.isPending}
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
              type="button"
            >
              <span className="flex size-4 items-center justify-center">
                {selectedIds.has(tag.id) && <Check className="size-4" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
            </button>
          ))}
          {matchingTags.length === 0 && !canCreate && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">没有匹配的标签</p>
          )}
          {canCreate && (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-primary hover:bg-muted disabled:opacity-50"
              disabled={createTag.isPending || setWordTags.isPending}
              onClick={createAndAssign}
              type="button"
            >
              <Plus className="size-4" />
              创建并添加“{search.trim()}”
            </button>
          )}
        </div>
        {setWordTags.isError && (
          <p className="border-t p-2 text-xs text-destructive">{setWordTags.error.message}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
