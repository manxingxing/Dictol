import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  CircleAlert,
  CircleCheck,
  Clock3,
  Code2,
  ChevronDown,
  Database,
  Files,
  FolderOpen,
  FolderSearch,
  GripVertical,
  Info,
  Library,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
  Power,
  BookText
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
import { Input } from '@/components/ui/input'
import { DictionaryAvatar } from '@/components/DictionaryIcon'
import { DictionaryInfoDialog } from '@/components/DictionaryInfoDialog'
import { DictionaryIndexDialog } from '@/components/DictionaryIndexDialog'
import { RenameDictionaryDialog } from '@/components/RenameDictionaryDialog'
import { OnlineDictionariesList } from '@/components/OnlineDictionariesList'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  useDeleteDictionary,
  useDictionaries,
  useImportDictionary,
  useImportDictionariesFromFolder,
  useReorderDictionaries,
  useUpdateDictionaryEnabled
} from '@/hooks/use-dictionaries'
import { formatFileSize } from '@/lib/utils'

type DictionaryImportPreview = NonNullable<
  Awaited<ReturnType<Window['dictol']['dictionaries']['selectFile']>>
>
type DictionaryFolderImportPreview = NonNullable<
  Awaited<ReturnType<Window['dictol']['dictionaries']['selectFolder']>>
>
export function DictionariesPage(): React.JSX.Element {
  const { data: dictionaries = [], isLoading, isError } = useDictionaries()
  const importDictionary = useImportDictionary()
  const importDictionariesFromFolder = useImportDictionariesFromFolder()
  const deleteDictionary = useDeleteDictionary()
  const reorderDictionaries = useReorderDictionaries()
  const updateDictionaryEnabled = useUpdateDictionaryEnabled()
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importDialogStep, setImportDialogStep] = useState<'select' | 'preview'>('select')
  const [importPreview, setImportPreview] = useState<DictionaryImportPreview | null>(null)
  const [selectedImportFiles, setSelectedImportFiles] = useState<Set<string>>(() => new Set())
  const [copyDictionaryFiles, setCopyDictionaryFiles] = useState(true)
  const [previewSelectionSnapshot, setPreviewSelectionSnapshot] = useState<Set<string>>(
    () => new Set()
  )
  const [selectingImportFile, setSelectingImportFile] = useState(false)
  const [importFileError, setImportFileError] = useState<string | null>(null)
  const [folderImportDialogOpen, setFolderImportDialogOpen] = useState(false)
  const [folderImportPreview, setFolderImportPreview] =
    useState<DictionaryFolderImportPreview | null>(null)
  const [selectedFolderMdxPaths, setSelectedFolderMdxPaths] = useState<Set<string>>(() => new Set())
  const [copyFolderDictionaryFiles, setCopyFolderDictionaryFiles] = useState(true)
  const [selectingImportFolder, setSelectingImportFolder] = useState(false)
  const [folderImportError, setFolderImportError] = useState<string | null>(null)
  // 修改词典名称
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [draggedDictionaryId, setDraggedDictionaryId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    position: 'before' | 'after'
  } | null>(null)
  const [openingCustomCssId, setOpeningCustomCssId] = useState<string | null>(null)
  const [dictionaryInfoId, setDictionaryInfoId] = useState<string | null>(null)
  // 查看词典索引
  const [indexTarget, setIndexTarget] = useState<{ id: string; name: string } | null>(null)

  const selectedFolderDictionaryCount = selectedFolderMdxPaths.size

  const finishDragging = (): void => {
    setDraggedDictionaryId(null)
    setDropTarget(null)
  }

  const openDictionaryDirectory = async (
    dictionaryId: string,
    dictionaryName: string
  ): Promise<void> => {
    try {
      await window.dictol.dictionaries.openDirectory(dictionaryId)
    } catch (error) {
      console.error('Failed to open dictionary directory', { dictionaryId, error })
      toast.error(`无法打开“${dictionaryName}”所在目录`, {
        description: error instanceof Error ? error.message : '请稍后重试。'
      })
    }
  }

  const openDictionaryInfo = (dictionaryId: string): void => {
    setDictionaryInfoId(dictionaryId)
  }

  const openCustomCssEditor = async (
    dictionaryId: string,
    dictionaryName: string
  ): Promise<void> => {
    setOpeningCustomCssId(dictionaryId)
    try {
      await window.dictol.dictionaries.openCustomCssEditor(dictionaryId)
    } catch (error) {
      toast.error(`无法打开“${dictionaryName}”的 CSS 编辑器`, {
        description: error instanceof Error ? error.message : '请稍后重试。'
      })
    } finally {
      setOpeningCustomCssId(null)
    }
  }

  const selectImportFile = async (): Promise<void> => {
    importDictionary.reset()
    setSelectingImportFile(true)
    setImportFileError(null)
    try {
      const preview = await window.dictol.dictionaries.selectFile()
      if (!preview) return
      setImportPreview(preview)
      setSelectedImportFiles(new Set(preview.files.map((file) => file.relativePath)))
    } catch (error) {
      console.error('Failed to select dictionary file', error)
      setImportFileError(error instanceof Error ? error.message : '无法读取词典文件。')
    } finally {
      setSelectingImportFile(false)
    }
  }

  const openImportDialog = (): void => {
    importDictionary.reset()
    setImportDialogStep('select')
    setImportPreview(null)
    setSelectedImportFiles(new Set())
    setCopyDictionaryFiles(true)
    setImportFileError(null)
    setImportDialogOpen(true)
  }

  const openFolderImportDialog = (): void => {
    importDictionariesFromFolder.reset()
    setFolderImportPreview(null)
    setSelectedFolderMdxPaths(new Set())
    setCopyFolderDictionaryFiles(true)
    setFolderImportError(null)
    setFolderImportDialogOpen(true)
  }

  const selectImportFolder = async (): Promise<void> => {
    importDictionariesFromFolder.reset()
    setSelectingImportFolder(true)
    setFolderImportPreview(null)
    setSelectedFolderMdxPaths(new Set())
    setFolderImportError(null)
    try {
      const preview = await window.dictol.dictionaries.selectFolder()
      if (preview) {
        setFolderImportPreview(preview)
        setSelectedFolderMdxPaths(
          new Set(preview.dictionaries.map((dictionary) => dictionary.mdxPath))
        )
      }
    } catch (error) {
      console.error('Failed to scan dictionary folder', error)
      setFolderImportError(error instanceof Error ? error.message : '无法扫描词典目录。')
    } finally {
      setSelectingImportFolder(false)
    }
  }

  const closeFolderImportDialog = (): void => {
    setFolderImportDialogOpen(false)
    setFolderImportPreview(null)
    setSelectedFolderMdxPaths(new Set())
    setCopyFolderDictionaryFiles(true)
    setFolderImportError(null)
  }

  const submitFolderImport = async (): Promise<void> => {
    if (!folderImportPreview) return
    const imported = await importDictionariesFromFolder.mutateAsync({
      rootPath: folderImportPreview.rootPath,
      copyFiles: copyFolderDictionaryFiles,
      selectedMdxPaths: [...selectedFolderMdxPaths]
    })
    closeFolderImportDialog()
    toast.success(`已加入 ${imported.length} 部词典，正在建立索引`)
  }

  const closeImportDialog = (): void => {
    setImportDialogOpen(false)
    setImportDialogStep('select')
    setImportPreview(null)
    setSelectedImportFiles(new Set())
    setCopyDictionaryFiles(true)
    setPreviewSelectionSnapshot(new Set())
    setImportFileError(null)
  }

  const closeImportPreview = (applySelection: boolean): void => {
    if (!applySelection) setSelectedImportFiles(new Set(previewSelectionSnapshot))
    setImportDialogStep('select')
  }

  const submitImport = async (copyFiles: boolean): Promise<void> => {
    if (!importPreview) return

    await importDictionary.mutateAsync({
      mdxPath: importPreview.mdxPath,
      copyFiles,
      selectedRelativePaths: importPreview.files
        .filter((file) => selectedImportFiles.has(file.relativePath))
        .map((file) => file.relativePath)
    })
    closeImportDialog()
  }

  const selectedImportFileItems =
    importPreview?.files.filter((file) => selectedImportFiles.has(file.relativePath)) ?? []
  const selectedImportSize = selectedImportFileItems.reduce(
    (total, file) => total + file.fileSize,
    0
  )
  const optionalImportFiles = importPreview?.files.filter((file) => !file.required) ?? []
  const selectedOptionalImportFileCount = optionalImportFiles.filter((file) =>
    selectedImportFiles.has(file.relativePath)
  ).length
  const allOptionalImportFilesSelected =
    optionalImportFiles.length == 0 || selectedOptionalImportFileCount === optionalImportFiles.length

  return (
    <section className="mx-auto flex max-w-3xl flex-col p-6 sm:p-8">
      <p className="mb-2 text-sm font-medium text-primary">词典库</p>
      <h1 className="text-xl font-semibold tracking-tight">管理你的词典</h1>

      <div className="mt-8">
        <section className="pb-6">
          <div className="mb-3 flex items-start justify-between gap-5">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold leading-5">本地词典</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                拖动以调整词典顺序。查词结果中的词典会使用相同顺序
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild className="h-8 shrink-0" size="sm" type="button" variant="outline">
                <NavLink to="/dictionaries/groups">
                  <Library className="size-4" />
                  词典组
                </NavLink>
              </Button>
              <div className="flex shrink-0 items-stretch">
                <Button
                  className="h-8 rounded-r-none"
                  onClick={openImportDialog}
                  size="sm"
                  type="button"
                >
                  <Upload />
                  导入词典
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="更多导入方式"
                      className="rounded-l-none border-l border-primary-foreground/30 px-2"
                      size="sm"
                      title="更多导入方式"
                      type="button"
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={openFolderImportDialog}>
                      <FolderSearch className="size-4" />
                      扫描文件夹导入
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
            {isLoading && (
              <p className="bg-card px-4 py-5 text-sm text-muted-foreground">正在加载…</p>
            )}
            {isError && (
              <p className="bg-card px-4 py-5 text-sm text-destructive">
                加载词典失败，请稍后重试。
              </p>
            )}
            {!isLoading && !isError && dictionaries.length === 0 && (
              <p className="bg-card px-4 py-5 text-sm text-muted-foreground">暂无词典。</p>
            )}
            {!isLoading && !isError && dictionaries.length > 0 && (
              <ul className="divide-y divide-border">
                {dictionaries.map((dictionary) => {
                  const status = dictionaryStatus[dictionary.status]
                  const StatusIcon = status.icon
                  const isDeleting =
                    deleteDictionary.isPending && deleteDictionary.variables === dictionary.id

                  return (
                    <li
                      key={dictionary.id}
                      className={`flex min-h-16 items-center gap-3 bg-card px-4 py-3 transition-[background-color,opacity,filter] hover:bg-muted/40 ${
                        !dictionary.enabled ? 'bg-muted/25 grayscale opacity-65' : ''
                      } ${draggedDictionaryId === dictionary.id ? 'opacity-45' : ''} ${
                        dropTarget?.id === dictionary.id
                          ? dropTarget.position === 'before'
                            ? 'border-t-2 border-t-primary'
                            : 'border-b-2 border-b-primary'
                          : ''
                      }`}
                      onDragOver={(event) => {
                        if (!draggedDictionaryId || draggedDictionaryId === dictionary.id) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        const bounds = event.currentTarget.getBoundingClientRect()
                        setDropTarget({
                          id: dictionary.id,
                          position:
                            event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                        })
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        if (!draggedDictionaryId) return
                        const bounds = event.currentTarget.getBoundingClientRect()
                        const dropPosition =
                          event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                        const nextOrder = dictionaries
                          .map((item) => item.id)
                          .filter((id) => id !== draggedDictionaryId)
                        let targetIndex = nextOrder.indexOf(dictionary.id)
                        if (targetIndex < 0) return
                        if (dropPosition === 'after') targetIndex += 1
                        nextOrder.splice(targetIndex, 0, draggedDictionaryId)
                        finishDragging()
                        reorderDictionaries.mutate(nextOrder)
                      }}
                    >
                      <button
                        aria-label={`拖动排序 ${dictionary.name}`}
                        className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                        disabled={reorderDictionaries.isPending}
                        draggable={!reorderDictionaries.isPending}
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
                      <DictionaryAvatar iconUrl={dictionary.iconUrl} name={dictionary.name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{dictionary.name}</p>

                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                          >
                            <StatusIcon
                              className={`size-3.5 ${dictionary.status === 'importing' ? 'animate-spin' : ''}`}
                            />
                            {status.label}
                          </span>
                          {!dictionary.enabled && (
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              已禁用
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="shrink-0 rounded-full pr-3 py-0.5 text-xs text-muted-foreground">
                            {dictionary.recordCount
                              ? `${formatRecordCount(dictionary.recordCount)} 个词条`
                              : dictionary.status === 'importing'
                                ? '正在建立索引'
                                : '尚无词条统计'}
                          </span>
                          {dictionary.external && (
                            <span
                              className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              title={dictionary.dictPath ?? undefined}
                            >
                              外部文件
                            </span>
                          )}
                        </p>
                      </div>
                      <Button
                        aria-label={`修改词典名称 ${dictionary.name}`}
                        className="shrink-0 text-muted-foreground"
                        onClick={() => {
                          setRenameTarget({ id: dictionary.id, name: dictionary.name })
                        }}
                        size="icon"
                        title="修改名称"
                        type="button"
                        variant="ghost"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        aria-label={`编辑自定义 CSS ${dictionary.name}`}
                        className={`shrink-0 ${dictionary.customCss ? 'text-primary' : 'text-muted-foreground'}`}
                        disabled={dictionary.status !== 'ready' || openingCustomCssId !== null}
                        onClick={() => {
                          void openCustomCssEditor(dictionary.id, dictionary.name)
                        }}
                        size="icon"
                        title={
                          openingCustomCssId === dictionary.id
                            ? '正在打开 CSS 编辑器…'
                            : '自定义 CSS'
                        }
                        type="button"
                        variant="ghost"
                      >
                        {openingCustomCssId === dictionary.id ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Code2 />
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={`更多词典操作 ${dictionary.name}`}
                            className="shrink-0 text-muted-foreground"
                            disabled={isDeleting || deleteDictionary.isPending}
                            size="icon"
                            title="更多操作"
                            type="button"
                            variant="ghost"
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            className="text-sm"
                            disabled={
                              dictionary.status !== 'ready' ||
                              (updateDictionaryEnabled.isPending &&
                                updateDictionaryEnabled.variables?.dictionaryId === dictionary.id)
                            }
                            onClick={() => {
                              updateDictionaryEnabled.mutate({
                                dictionaryId: dictionary.id,
                                enabled: !dictionary.enabled
                              })
                            }}
                          >
                            <Power className="size-3.5" />
                            {dictionary.enabled ? '禁用' : '启用'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-sm"
                            onClick={() => {
                              openDictionaryInfo(dictionary.id)
                            }}
                          >
                            <Info className="size-3.5" />
                            信息
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-sm"
                            disabled={dictionary.status !== 'ready'}
                            onClick={() => {
                              void window.dictol.dictionaries.openBrowse(dictionary.id)
                            }}
                          >
                            <BookText className="size-3.5" />
                            浏览
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-sm"
                            onClick={() =>
                              setIndexTarget({ id: dictionary.id, name: dictionary.name })
                            }
                          >
                            <Database className="size-3.5" />
                            查看索引
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-sm"
                            onClick={() => {
                              void openDictionaryDirectory(dictionary.id, dictionary.name)
                            }}
                          >
                            <FolderOpen className="size-3.5" />
                            打开所在目录
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-sm hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
                            disabled={
                              dictionary.status === 'importing' || deleteDictionary.isPending
                            }
                            onClick={() => {
                              if (
                                window.confirm(
                                  `确定删除“${dictionary.name}”吗？词典记录和索引会被删除${dictionary.external ? '，原文件不会被删除。' : '，已复制文件也会被删除。'}`
                                )
                              ) {
                                deleteDictionary.mutate(dictionary.id)
                              }
                            }}
                          >
                            <Trash2 className="size-3.5" />
                            删除词典
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  )
                })}
              </ul>
            )}
            {deleteDictionary.isError && (
              <p className="border-t border-border bg-card px-4 py-3 text-xs text-destructive">
                删除失败：{deleteDictionary.error.message}
              </p>
            )}
            {reorderDictionaries.isError && (
              <p className="border-t border-border bg-card px-4 py-3 text-xs text-destructive">
                排序保存失败：{reorderDictionaries.error.message}
              </p>
            )}
            {updateDictionaryEnabled.isError && (
              <p className="border-t border-border bg-card px-4 py-3 text-xs text-destructive">
                更新词典状态失败：{updateDictionaryEnabled.error.message}
              </p>
            )}
          </div>
        </section>

        <OnlineDictionariesList />
      </div>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (open || importDictionary.isPending || selectingImportFile) return
          if (importDialogStep === 'preview') closeImportPreview(false)
          else closeImportDialog()
        }}
      >
        <DialogContent
          className={
            importDialogStep === 'preview'
              ? 'max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl'
              : undefined
          }
        >
          {importDialogStep === 'preview' && importPreview ? (
            <>
              <DialogHeader className="border-b border-border px-6 pb-5 pt-6 pr-14">
                <DialogTitle>预览词典文件</DialogTitle>
                <DialogDescription>
                  取消选择不属于该词典的资源；MDX 主文件必须保留。
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 min-w-0 overflow-y-auto px-6 py-4">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      checked={allOptionalImportFilesSelected}
                      className="size-4 accent-primary"
                      disabled={optionalImportFiles.length === 0}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setSelectedImportFiles(
                          new Set(
                            importPreview.files
                              .filter((file) => file.required || checked)
                              .map((file) => file.relativePath)
                          )
                        )
                      }}
                      ref={(node) => {
                        if (node) {
                          node.indeterminate =
                            selectedOptionalImportFileCount > 0 &&
                            selectedOptionalImportFileCount < optionalImportFiles.length
                        }
                      }}
                      type="checkbox"
                    />
                    选择全部资源文件
                  </label>
                  <span className="text-xs text-muted-foreground">按导入规则递归发现</span>
                </div>
                <div className="min-w-0 overflow-hidden rounded-xl border border-border">
                  {importPreview.files.map((file) => {
                    const extension = getFileExtension(file.relativePath)
                    return (
                      <label
                        className="grid min-h-14 min-w-0 grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border/70 px-3 py-2 last:border-b-0 hover:bg-muted/35"
                        key={file.relativePath}
                      >
                        <input
                          checked={selectedImportFiles.has(file.relativePath)}
                          className="size-4 accent-primary disabled:cursor-not-allowed"
                          disabled={file.required}
                          onChange={(event) => {
                            setSelectedImportFiles((current) => {
                              const next = new Set(current)
                              if (event.target.checked) next.add(file.relativePath)
                              else next.delete(file.relativePath)
                              return next
                            })
                          }}
                          type="checkbox"
                        />
                        <span
                          className={`flex size-9 items-center justify-center rounded-lg font-mono text-[9px] font-semibold uppercase ${
                            file.required
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {extension}
                        </span>
                        <span className="min-w-0 overflow-hidden">
                          <span
                            className="block truncate text-sm font-medium"
                            title={getFileName(file.relativePath)}
                          >
                            {getFileName(file.relativePath)}
                          </span>
                          <span
                            className="mt-0.5 block truncate text-xs text-muted-foreground"
                            title={file.relativePath}
                          >
                            {file.relativePath}
                            {file.required ? ' · 必需' : ''}
                          </span>
                        </span>
                        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {formatFileSize(file.fileSize)}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <DialogFooter className="border-t border-border bg-muted/20 px-6 py-4 sm:items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">
                  已选择 {selectedImportFileItems.length} / {importPreview.files.length} 个文件，共{' '}
                  {formatFileSize(selectedImportSize)}
                </span>
                <div className="flex justify-end gap-2">
                  <Button onClick={() => closeImportPreview(false)} type="button" variant="outline">
                    取消
                  </Button>
                  <Button onClick={() => closeImportPreview(true)} type="button">
                    确定
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : (
            <form
              className="grid min-w-0 gap-5"
              onSubmit={(event) => {
                event.preventDefault()
                void submitImport(copyDictionaryFiles).catch(() => undefined)
              }}
            >
              <DialogHeader>
                <DialogTitle>导入本地词典</DialogTitle>
                <DialogDescription>
                  选择一个 MDX 文件，Dictol 会查找同目录中的相关资源
                </DialogDescription>
              </DialogHeader>
              <div className="grid min-w-0 gap-2">
                <label className="text-sm font-medium" htmlFor="dictionary-import-file">
                  MDX 文件
                </label>
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    className="h-9 w-0 min-w-0 flex-1"
                    id="dictionary-import-file"
                    placeholder="尚未选择文件"
                    readOnly
                    value={importPreview?.mdxPath ?? ''}
                  />
                  <Button
                    className="shrink-0"
                    disabled={importDictionary.isPending || selectingImportFile}
                    onClick={() => void selectImportFile()}
                    type="button"
                    variant="outline"
                  >
                    {selectingImportFile ? '正在读取…' : '选择文件'}
                  </Button>
                </div>
              </div>
              {importPreview && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    checked={copyDictionaryFiles}
                    className="size-4 accent-primary"
                    disabled={importDictionary.isPending || selectingImportFile}
                    onChange={(event) => setCopyDictionaryFiles(event.target.checked)}
                    type="checkbox"
                  />
                  将词典文件复制到软件中
                </label>
              )}
              {importPreview && (
                <div className="flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.035] p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Files className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      已选择 {selectedImportFileItems.length} 个文件
                    </p>
                    <p
                      className="mt-0.5 truncate text-xs text-muted-foreground"
                      title={getFileName(importPreview.mdxPath)}
                    >
                      {getFileName(importPreview.mdxPath)} · {formatFileSize(selectedImportSize)}
                    </p>
                  </div>
                  <Button
                    className="shrink-0 text-primary"
                    onClick={() => {
                      setPreviewSelectionSnapshot(new Set(selectedImportFiles))
                      setImportDialogStep('preview')
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    预览
                  </Button>
                </div>
              )}
              {importFileError && <p className="text-sm text-destructive">{importFileError}</p>}
              {importDictionary.isError && (
                <p className="text-sm text-destructive">
                  导入失败：{importDictionary.error.message}
                </p>
              )}
              <DialogFooter>
                <Button
                  disabled={importDictionary.isPending || selectingImportFile}
                  onClick={closeImportDialog}
                  type="button"
                  variant="outline"
                >
                  取消
                </Button>
                <Button disabled={!importPreview || importDictionary.isPending} type="submit">
                  {importDictionary.isPending ? '正在导入…' : '导入'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={folderImportDialogOpen}
        onOpenChange={(open) => {
          if (open || importDictionariesFromFolder.isPending || selectingImportFolder) return
          closeFolderImportDialog()
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-border px-6 pb-5 pt-6 pr-14">
            <DialogTitle>扫描文件夹导入</DialogTitle>
            <DialogDescription>递归查找 MDX；每个 MDX 只使用所在目录中的资源。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 min-w-0 overflow-y-auto px-6 py-5">
            <div className="grid min-w-0 gap-2">
              <label className="text-sm font-medium" htmlFor="dictionary-import-folder">
                词典目录
              </label>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  className="h-9 w-0 min-w-0 flex-1"
                  id="dictionary-import-folder"
                  placeholder="尚未选择目录"
                  readOnly
                  value={folderImportPreview?.rootPath ?? ''}
                />
                <Button
                  className="shrink-0"
                  disabled={importDictionariesFromFolder.isPending || selectingImportFolder}
                  onClick={() => void selectImportFolder()}
                  type="button"
                  variant="outline"
                >
                  {selectingImportFolder ? '正在扫描…' : '选择目录'}
                </Button>
              </div>
            </div>

            {folderImportPreview && (
              <>
                <label className="mt-5 flex items-center gap-2 text-sm">
                  <input
                    checked={copyFolderDictionaryFiles}
                    className="size-4 accent-primary"
                    disabled={importDictionariesFromFolder.isPending || selectingImportFolder}
                    onChange={(event) => setCopyFolderDictionaryFiles(event.target.checked)}
                    type="checkbox"
                  />
                  将词典文件复制到软件中
                </label>
                <div className="mt-5 overflow-hidden rounded-xl border border-border">
                  <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        aria-label="全选词典"
                        checked={
                          folderImportPreview.dictionaries.length > 0 &&
                          selectedFolderDictionaryCount === folderImportPreview.dictionaries.length
                        }
                        className="size-4 accent-primary"
                        disabled={importDictionariesFromFolder.isPending || selectingImportFolder}
                        onChange={(event) => {
                          setSelectedFolderMdxPaths(
                            event.target.checked
                              ? new Set(
                                  folderImportPreview.dictionaries.map(
                                    (dictionary) => dictionary.mdxPath
                                  )
                                )
                              : new Set()
                          )
                        }}
                        type="checkbox"
                      />
                      已选择 {selectedFolderDictionaryCount} /{' '}
                      {folderImportPreview.dictionaries.length} 部词典
                    </label>
                    <span className="text-xs text-muted-foreground">索引将在后台建立</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {folderImportPreview.dictionaries.map((dictionary) => (
                      <li
                        className="flex min-w-0 items-center justify-between gap-4 px-3 py-2.5"
                        key={dictionary.mdxPath}
                      >
                        <label className="flex min-w-0 items-center gap-2">
                          <input
                            aria-label={`选择 ${dictionary.relativePath}`}
                            checked={selectedFolderMdxPaths.has(dictionary.mdxPath)}
                            className="size-4 shrink-0 accent-primary"
                            disabled={
                              importDictionariesFromFolder.isPending || selectingImportFolder
                            }
                            onChange={(event) => {
                              setSelectedFolderMdxPaths((current) => {
                                const next = new Set(current)
                                if (event.target.checked) next.add(dictionary.mdxPath)
                                else next.delete(dictionary.mdxPath)
                                return next
                              })
                            }}
                            type="checkbox"
                          />
                          <span className="min-w-0 truncate text-sm" title={dictionary.mdxPath}>
                            {dictionary.relativePath}
                          </span>
                        </label>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {dictionary.resourceFileCount} 个资源
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            {folderImportPreview && folderImportPreview.dictionaries.length === 0 && (
              <p className="mt-5 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                这个目录及其子目录中没有找到 MDX 文件。
              </p>
            )}
            {folderImportPreview &&
              folderImportPreview.dictionaries.length > 0 &&
              selectedFolderDictionaryCount === 0 && (
                <p className="mt-4 text-sm text-muted-foreground">请至少选择一部词典。</p>
              )}
            {folderImportError && (
              <p className="mt-4 text-sm text-destructive">扫描失败：{folderImportError}</p>
            )}
            {importDictionariesFromFolder.isError && (
              <p className="mt-4 text-sm text-destructive">
                导入失败：{importDictionariesFromFolder.error.message}
              </p>
            )}
          </div>
          <DialogFooter className="border-t border-border bg-muted/20 px-6 py-4">
            <Button
              disabled={importDictionariesFromFolder.isPending || selectingImportFolder}
              onClick={closeFolderImportDialog}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={
                !folderImportPreview ||
                folderImportPreview.dictionaries.length === 0 ||
                selectedFolderDictionaryCount === 0 ||
                importDictionariesFromFolder.isPending
              }
              onClick={() => void submitFolderImport().catch(() => undefined)}
              type="button"
            >
              {importDictionariesFromFolder.isPending ? '正在导入…' : '导入已选词典'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RenameDictionaryDialog
        dictionary={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      />

      <DictionaryIndexDialog
        dictionary={indexTarget}
        onOpenChange={(open) => {
          if (!open) setIndexTarget(null)
        }}
      />

      <DictionaryInfoDialog
        dictionary={dictionaries.find((dictionary) => dictionary.id === dictionaryInfoId) ?? null}
        onOpenDirectory={openDictionaryDirectory}
        onOpenChange={(open) => {
          if (!open) setDictionaryInfoId(null)
        }}
      />
    </section>
  )
}

const dictionaryStatus = {
  pending: {
    label: '等待导入',
    icon: Clock3,
    className: 'bg-muted text-muted-foreground'
  },
  importing: {
    label: '导入中',
    icon: LoaderCircle,
    className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
  },
  ready: {
    label: '已就绪',
    icon: CircleCheck,
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  },
  error: {
    label: '导入失败',
    icon: CircleAlert,
    className: 'bg-destructive/10 text-destructive'
  }
} as const

function formatRecordCount(value: string): string {
  try {
    return new Intl.NumberFormat('zh-CN').format(BigInt(value))
  } catch {
    return value
  }
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function getFileExtension(filePath: string): string {
  const fileName = getFileName(filePath)
  const separatorIndex = fileName.lastIndexOf('.')
  return separatorIndex >= 0 ? fileName.slice(separatorIndex + 1) : 'file'
}
