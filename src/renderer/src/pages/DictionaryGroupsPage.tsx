import { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  ArrowLeft,
  GripVertical,
  Library,
  LoaderCircle,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { toast } from 'sonner'

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useDictionaries } from '@/hooks/use-dictionaries'
import {
  useCreateDictionaryGroup,
  useDeleteDictionaryGroup,
  useDictionaryGroups,
  useRenameDictionaryGroup,
  useUpdateDictionaryGroupMembers,
  type DictionaryGroup
} from '@/hooks/use-dictionary-groups'
import { cn } from '@/lib/utils'

type NameEditorState = { mode: 'create' } | { mode: 'rename'; groupId: string } | null

export function DictionaryGroupsPage(): React.JSX.Element {
  const {
    data: groups = [],
    isLoading: isGroupsLoading,
    isError: isGroupsError
  } = useDictionaryGroups()
  const {
    data: dictionaries = [],
    isLoading: isDictionariesLoading,
    isError: isDictionariesError
  } = useDictionaries()
  const createGroup = useCreateDictionaryGroup()
  const renameGroup = useRenameDictionaryGroup()
  const deleteGroup = useDeleteDictionaryGroup()
  const updateMembers = useUpdateDictionaryGroupMembers()

  const [nameEditor, setNameEditor] = useState<NameEditorState>(null)
  const [nameValue, setNameValue] = useState('')
  const [memberEditorGroupId, setMemberEditorGroupId] = useState<string | null>(null)
  const [memberSearch, setMemberSearch] = useState('')
  const [selectedDictionaryIds, setSelectedDictionaryIds] = useState<string[]>([])
  const [draggedDictionaryId, setDraggedDictionaryId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    position: 'before' | 'after'
  } | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DictionaryGroup | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const dictionariesById = useMemo(
    () => new Map(dictionaries.map((dictionary) => [dictionary.id, dictionary])),
    [dictionaries]
  )
  const memberEditorGroup = memberEditorGroupId
    ? groups.find((group) => group.id === memberEditorGroupId)
    : undefined
  const nameEditorGroup =
    nameEditor?.mode === 'rename'
      ? groups.find((group) => group.id === nameEditor.groupId)
      : undefined
  const filteredDictionaries = useMemo(() => {
    const normalizedSearch = memberSearch.trim().toLocaleLowerCase()
    if (!normalizedSearch) return dictionaries
    return dictionaries.filter((dictionary) =>
      dictionary.name.toLocaleLowerCase().includes(normalizedSearch)
    )
  }, [dictionaries, memberSearch])
  const filteredDictionaryIds = filteredDictionaries.map((dictionary) => dictionary.id)
  const selectedDictionaries = selectedDictionaryIds
    .map((dictionaryId) => dictionariesById.get(dictionaryId))
    .filter((dictionary) => dictionary !== undefined)
  const availableDictionaries = filteredDictionaries.filter(
    (dictionary) => !selectedDictionaryIds.includes(dictionary.id)
  )
  const allFilteredSelected =
    filteredDictionaryIds.length > 0 &&
    filteredDictionaryIds.every((dictionaryId) => selectedDictionaryIds.includes(dictionaryId))
  const isNameSaving = createGroup.isPending || renameGroup.isPending
  const isMembersSaving = updateMembers.isPending
  const nameDirty =
    nameEditor?.mode === 'create'
      ? nameValue.trim().length > 0
      : nameEditorGroup !== undefined && nameValue.trim() !== nameEditorGroup.name
  const membersDirty =
    memberEditorGroup !== undefined &&
    (selectedDictionaryIds.length !== memberEditorGroup.dictionaryIds.length ||
      selectedDictionaryIds.some(
        (dictionaryId, index) => dictionaryId !== memberEditorGroup.dictionaryIds[index]
      ))

  const resetEditorMutations = (): void => {
    createGroup.reset()
    renameGroup.reset()
    updateMembers.reset()
    setEditorError(null)
  }

  const openCreateEditor = (): void => {
    resetEditorMutations()
    setNameEditor({ mode: 'create' })
    setNameValue('')
  }

  const openRenameEditor = (group: DictionaryGroup): void => {
    resetEditorMutations()
    setNameEditor({ mode: 'rename', groupId: group.id })
    setNameValue(group.name)
  }

  const openMembersEditor = (group: DictionaryGroup): void => {
    resetEditorMutations()
    setMemberEditorGroupId(group.id)
    setMemberSearch('')
    setSelectedDictionaryIds(group.dictionaryIds)
  }

  const closeNameEditor = (): void => {
    if (isNameSaving) return
    setNameEditor(null)
    setNameValue('')
    setEditorError(null)
  }

  const closeMembersEditor = (): void => {
    if (isMembersSaving) return
    setMemberEditorGroupId(null)
    setMemberSearch('')
    setSelectedDictionaryIds([])
    finishDragging()
    setEditorError(null)
  }

  const toggleDictionary = (dictionaryId: string): void => {
    setSelectedDictionaryIds((current) =>
      current.includes(dictionaryId)
        ? current.filter((id) => id !== dictionaryId)
        : [...current, dictionaryId]
    )
  }

  const finishDragging = (): void => {
    setDraggedDictionaryId(null)
    setDropTarget(null)
  }

  const reorderSelectedDictionary = (targetId: string, position: 'before' | 'after'): void => {
    if (!draggedDictionaryId || draggedDictionaryId === targetId) return

    const nextOrder = selectedDictionaryIds.filter((id) => id !== draggedDictionaryId)
    let targetIndex = nextOrder.indexOf(targetId)
    if (targetIndex < 0) return
    if (position === 'after') targetIndex += 1
    nextOrder.splice(targetIndex, 0, draggedDictionaryId)
    setSelectedDictionaryIds(nextOrder)
    finishDragging()
  }

  const selectAllFiltered = (): void => {
    setSelectedDictionaryIds((current) => {
      const next = new Set(current)
      filteredDictionaryIds.forEach((dictionaryId) => next.add(dictionaryId))
      return [...next]
    })
  }

  const clearFilteredSelection = (): void => {
    setSelectedDictionaryIds((current) =>
      current.filter((dictionaryId) => !filteredDictionaryIds.includes(dictionaryId))
    )
  }

  const saveNameEditor = async (): Promise<void> => {
    const name = nameValue.trim()
    if (!nameEditor || !name) {
      setEditorError('请输入词典组名称。')
      return
    }
    if (nameEditor.mode === 'rename' && !nameEditorGroup) {
      setEditorError('词典组已不存在，请关闭后刷新页面。')
      return
    }

    setEditorError(null)
    try {
      if (nameEditor.mode === 'create') {
        await createGroup.mutateAsync(name)
        toast.success('词典组已创建')
      } else {
        await renameGroup.mutateAsync({ groupId: nameEditorGroup!.id, name })
        toast.success('词典组名称已更新')
      }
      closeNameEditor()
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存词典组名称失败。'
      setEditorError(message)
      toast.error(message)
    }
  }

  const saveMembersEditor = async (): Promise<void> => {
    if (!memberEditorGroup) {
      setEditorError('词典组已不存在，请关闭后刷新页面。')
      return
    }

    setEditorError(null)
    try {
      await updateMembers.mutateAsync({
        groupId: memberEditorGroup.id,
        dictionaryIds: selectedDictionaryIds
      })
      toast.success('词典组成员已更新')
      closeMembersEditor()
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存词典组成员失败。'
      setEditorError(message)
      toast.error(message)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    const captureStatus = await window.dictol.wordCapture.getStatus()
    if (captureStatus?.selectionDictionaryGroupId === deleteTarget.id) {
      setDeleteError('该词典组正在用于“取词组”，请先在设置中修改取词组后再删除。')
      return
    }
    setDeleteError(null)
    try {
      await deleteGroup.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
      toast.success('词典组已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除词典组失败。')
    }
  }

  const renderGroupMembers = (group: DictionaryGroup): React.JSX.Element => {
    if (isDictionariesLoading) {
      return <span className="text-sm text-muted-foreground">正在加载词典…</span>
    }
    if (isDictionariesError) {
      return <span className="text-sm text-muted-foreground">成员信息暂不可用</span>
    }

    const memberNames = group.dictionaryIds.map(
      (dictionaryId) => dictionariesById.get(dictionaryId)?.name ?? '词典已移除'
    )
    const visibleNames = memberNames.slice(0, 3)
    const remainingCount = Math.max(0, memberNames.length - visibleNames.length)

    if (memberNames.length === 0) {
      return <span className="text-sm text-muted-foreground">尚未添加词典</span>
    }

    return (
      <>
        {visibleNames.map((name, index) => (
          <span
            className="max-w-48 truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
            key={`${name}-${index}`}
          >
            {name}
          </span>
        ))}
        {remainingCount > 0 && (
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            +{remainingCount} 部
          </span>
        )}
      </>
    )
  }

  const renderDictionaryStatus = (dictionary: (typeof dictionaries)[number]): React.JSX.Element => (
    <span
      className={cn(
        'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] leading-4',
        dictionary.enabled && dictionary.status === 'ready'
          ? 'border-primary/20 bg-primary/10 text-primary'
          : 'border-border bg-muted text-muted-foreground'
      )}
    >
      {!dictionary.enabled ? '已禁用' : dictionary.status === 'ready' ? '可用' : dictionary.status}
    </span>
  )

  const renderSelectedDictionary = (
    dictionary: (typeof dictionaries)[number]
  ): React.JSX.Element => (
    <div
      key={dictionary.id}
      className={cn(
        'flex items-center gap-2 px-3 py-1 transition-colors hover:bg-muted/50',
        draggedDictionaryId === dictionary.id ? 'opacity-45' : '',
        dropTarget?.id === dictionary.id
          ? dropTarget.position === 'before'
            ? 'border-t-2 border-t-primary'
            : 'border-b-2 border-b-primary'
          : ''
      )}
      onDragOver={(event) => {
        if (!draggedDictionaryId || draggedDictionaryId === dictionary.id) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const bounds = event.currentTarget.getBoundingClientRect()
        setDropTarget({
          id: dictionary.id,
          position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
        })
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (!draggedDictionaryId) return
        const bounds = event.currentTarget.getBoundingClientRect()
        reorderSelectedDictionary(
          dictionary.id,
          event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
        )
      }}
    >
      <button
        aria-label={`拖动排序 ${dictionary.name}`}
        className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        disabled={isMembersSaving}
        draggable={!isMembersSaving}
        onDragEnd={finishDragging}
        onDragStart={(event) => {
          setDraggedDictionaryId(dictionary.id)
          setDropTarget(null)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', dictionary.id)
        }}
        type="button"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="min-w-0 flex-1 truncate py-2 text-sm">{dictionary.name}</span>
      {renderDictionaryStatus(dictionary)}
      <Button
        aria-label={`从词典组移除 ${dictionary.name}`}
        className="size-7 shrink-0 text-muted-foreground"
        disabled={isMembersSaving}
        onClick={() => toggleDictionary(dictionary.id)}
        size="icon"
        title="移除词典"
        type="button"
        variant="ghost"
      >
        <X className="size-4" />
      </Button>
    </div>
  )

  const renderAvailableDictionary = (
    dictionary: (typeof dictionaries)[number]
  ): React.JSX.Element => (
    <button
      aria-label={`添加词典 ${dictionary.name}`}
      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      disabled={isMembersSaving}
      key={dictionary.id}
      onClick={() => toggleDictionary(dictionary.id)}
      type="button"
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded border border-input bg-background" />
      <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm">{dictionary.name}</span>
        {renderDictionaryStatus(dictionary)}
      </span>
    </button>
  )

  return (
    <section className="flex min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Button asChild className="-ml-2 mb-3" size="sm" type="button" variant="ghost">
              <NavLink to="/dictionaries">
                <ArrowLeft />
                词典库
              </NavLink>
            </Button>
            <div className="flex items-center gap-2">
              <Library className="size-5 shrink-0 text-primary" />
              <h1 className="text-xl font-semibold tracking-tight">词典组</h1>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              为不同的查询任务选择一组常用词典。
            </p>
          </div>
          <Button className="shrink-0" onClick={openCreateEditor} type="button">
            <Plus />
            新建词典组
          </Button>
        </header>

        {isGroupsLoading ? (
          <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            正在加载词典组…
          </div>
        ) : isGroupsError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">
            加载词典组失败，请稍后重试。
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <Library className="mx-auto mb-3 size-8 text-muted-foreground" />
            <h2 className="text-base font-semibold">还没有词典组</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              创建词典组后，可以在搜索框中快速切换查询范围。
            </p>
            <Button className="mt-5" onClick={openCreateEditor} type="button">
              <Plus />
              创建第一个词典组
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {groups.map((group) => (
              <article
                className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center"
                key={group.id}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Library className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <h2 className="truncate text-sm font-semibold">{group.name}</h2>
                      <span className="text-xs text-muted-foreground">
                        {group.dictionaryIds.length} 部词典
                      </span>
                    </div>
                    <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
                      {renderGroupMembers(group)}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-1 sm:self-start">
                  <Button
                    aria-label={`编辑词典组名称 ${group.name}`}
                    className="shrink-0 text-muted-foreground"
                    onClick={() => openRenameEditor(group)}
                    size="icon"
                    title="编辑词典组名称"
                    type="button"
                    variant="ghost"
                  >
                    <Pencil />
                  </Button>
                  <Button
                    aria-label={`编辑词典成员 ${group.name}`}
                    className="shrink-0 text-muted-foreground"
                    onClick={() => openMembersEditor(group)}
                    size="icon"
                    title="编辑词典成员"
                    type="button"
                    variant="ghost"
                  >
                    <ListChecks />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={`更多操作：${group.name}`}
                        className="size-8"
                        size="icon"
                        title="更多操作"
                        type="button"
                        variant="ghost"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => {
                          setDeleteError(null)
                          setDeleteTarget(group)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        删除词典组
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) closeNameEditor()
        }}
        open={nameEditor !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{nameEditor?.mode === 'create' ? '新建词典组' : '编辑组名'}</DialogTitle>
            <DialogDescription>
              {nameEditor?.mode === 'create'
                ? '为新词典组设置一个名称'
                : '修改词典组的显示名称'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!isNameSaving) void saveNameEditor()
            }}
          >
            <label className="grid gap-2 text-sm font-medium" htmlFor="dictionary-group-name">
              组名
              <Input
                autoFocus
                id="dictionary-group-name"
                maxLength={100}
                onChange={(event) => setNameValue(event.target.value)}
                placeholder="例如：英语学习"
                value={nameValue}
              />
            </label>
            {editorError && <p className="text-sm text-destructive">{editorError}</p>}
            <DialogFooter>
              <Button
                disabled={isNameSaving}
                onClick={closeNameEditor}
                type="button"
                variant="outline"
              >
                取消
              </Button>
              <Button disabled={!nameDirty || isNameSaving} type="submit">
                {isNameSaving && <LoaderCircle className="animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) closeMembersEditor()
        }}
        open={memberEditorGroupId !== null}
      >
        <DialogContent className="flex h-[min(720px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5">
            <DialogTitle>编辑词典成员 {memberEditorGroup?.name ?? ''}</DialogTitle>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-2 md:grid-rows-1">
            <section className="flex min-h-0 min-w-0 flex-col border-b border-border md:border-b-0 md:border-r">
              <div className="shrink-0 space-y-3 border-b border-border px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium">可添加的词典</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {availableDictionaries.length} 部可选
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      disabled={filteredDictionaries.length === 0 || allFilteredSelected}
                      onClick={selectAllFiltered}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      全部添加
                    </Button>
                  </div>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="筛选可添加的词典"
                    className="pl-9"
                    onChange={(event) => setMemberSearch(event.target.value)}
                    placeholder="筛选词典"
                    value={memberSearch}
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto">
                {isDictionariesLoading ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    正在加载词典…
                  </p>
                ) : isDictionariesError ? (
                  <p className="px-4 py-8 text-center text-sm text-destructive">加载词典失败。</p>
                ) : dictionaries.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    还没有可加入的词典。
                  </p>
                ) : availableDictionaries.length > 0 ? (
                  <div className="divide-y divide-border">
                    {availableDictionaries.map(renderAvailableDictionary)}
                  </div>
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {memberSearch ? '没有匹配的可添加词典。' : '所有词典都已添加。'}
                  </p>
                )}
              </div>
            </section>

            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="shrink-0 border-b border-border px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium">已添加的词典</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedDictionaries.length} 部词典 · 拖动调整顺序
                    </p>
                  </div>
                  <Button
                    disabled={
                      filteredDictionaries.length === 0 ||
                      !filteredDictionaryIds.some((id) => selectedDictionaryIds.includes(id))
                    }
                    onClick={clearFilteredSelection}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    清除
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto">
                {selectedDictionaries.length > 0 ? (
                  <div className="divide-y divide-border">
                    {selectedDictionaries.map(renderSelectedDictionary)}
                  </div>
                ) : (
                  <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                    从左侧选择词典后，会显示在这里。
                  </div>
                )}
              </div>
            </section>
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
            <div className="mr-auto min-w-0">
              {editorError && <p className="text-sm text-destructive">{editorError}</p>}
            </div>
            <Button
              disabled={isMembersSaving}
              onClick={closeMembersEditor}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={!membersDirty || isMembersSaving || !memberEditorGroup}
              onClick={() => void saveMembersEditor()}
              type="button"
            >
              {isMembersSaving && <LoaderCircle className="animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setDeleteError(null)
            setDeleteTarget(null)
          }
        }}
        open={deleteTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除词典组</DialogTitle>
            <DialogDescription>
              将删除词典组「{deleteTarget?.name}」，不会删除组内的词典文件。
            </DialogDescription>
            {deleteError && (
              <p className="text-sm text-destructive" role="alert">
                {deleteError}
              </p>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDeleteTarget(null)} type="button" variant="outline">
              取消
            </Button>
            <Button
              disabled={deleteGroup.isPending}
              onClick={() => void confirmDelete()}
              type="button"
              variant="destructive"
            >
              {deleteGroup.isPending && <LoaderCircle className="animate-spin" />}
              删除词典组
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
