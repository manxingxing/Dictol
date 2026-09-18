import { useState } from 'react'
import { FolderOpen, LoaderCircle, RefreshCw } from 'lucide-react'
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
  useDictionaryIndexInfo,
  useReindexDictionary
} from '@/hooks/use-dictionaries'
import { formatFileSize, formatTime } from '@/lib/utils'

export interface DictionaryIndexDialogProps {
  dictionary: { id: string; name: string } | null
  onOpenChange: (open: boolean) => void
}

export function DictionaryIndexDialog({
  dictionary,
  onOpenChange
}: DictionaryIndexDialogProps): React.JSX.Element {
  const dictionaryId = dictionary?.id ?? null
  const { data: indexInfo, error, isLoading } = useDictionaryIndexInfo(dictionaryId)
  const reindexDictionary = useReindexDictionary()
  const [isOpeningIndexDirectory, setIsOpeningIndexDirectory] = useState(false)

  const indexInfoError = reindexDictionary.isError
    ? reindexDictionary.error.message
    : error?.message

  const handleReindex = (): void => {
    if (!dictionary) return
    void reindexDictionary
      .mutateAsync(dictionary.id)
      .then(() => toast.success(`“${dictionary.name}”已重新索引`))
      .catch(() => undefined)
  }

  const openIndexDirectory = async (): Promise<void> => {
    if (!dictionary) return
    setIsOpeningIndexDirectory(true)
    try {
      await window.dictol.dictionaries.openIndexDirectory(dictionary.id)
    } catch (error) {
      toast.error('无法打开索引所在文件夹', {
        description: error instanceof Error ? error.message : '请稍后重试。'
      })
    } finally {
      setIsOpeningIndexDirectory(false)
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onOpenChange(false)
      }}
      open={dictionary !== null}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>索引 · {dictionary?.name ?? ''}</DialogTitle>
          <DialogDescription>查看当前词典索引的位置和构建状态。</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            正在读取索引信息…
          </div>
        ) : indexInfoError ? (
          <p className="py-6 text-sm text-destructive" role="alert">
            {indexInfoError}
          </p>
        ) : indexInfo ? (
          <div className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">索引位置</p>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
                  {indexInfo.indexPath}
                </p>
                <Button
                  aria-label="打开索引所在文件夹"
                  disabled={isOpeningIndexDirectory}
                  onClick={() => void openIndexDirectory()}
                  size="icon"
                  title="打开所在文件夹"
                  type="button"
                  variant="outline"
                >
                  {isOpeningIndexDirectory ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <FolderOpen />
                  )}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">状态</p>
                <p className="mt-1 font-medium">
                  {
                    {
                      building: '构建中',
                      ready: '可用',
                      error: '错误',
                      needs_reindex: '需要重建',
                      missing: '索引文件不存在'
                    }[indexInfo.status]
                  }
                </p>
              </div>
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">词条数</p>
                <p className="mt-1 font-medium">
                  {indexInfo.entryCount?.toLocaleString() ?? '—'}
                </p>
              </div>
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">索引大小</p>
                <p className="mt-1 font-medium">
                  {indexInfo.fileSize === null ? '—' : formatFileSize(indexInfo.fileSize)}
                </p>
              </div>
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">构建时间</p>
                <p className="mt-1 font-medium">
                  {indexInfo.builtAt ? formatTime(indexInfo.builtAt) : '—'}
                </p>
              </div>
            </div>
            {indexInfo.status === 'missing' && (
              <p className="text-sm text-destructive" role="alert">
                索引文件不存在，请点击“重新索引”恢复查词功能。
              </p>
            )}
            {indexInfo.status === 'error' && (
              <p className="text-sm text-destructive" role="alert">
                索引验证失败，文件可能已损坏或与词典源文件不匹配，请点击“重新索引”恢复查词功能。
              </p>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            disabled={
              isLoading || reindexDictionary.isPending || indexInfo?.status === 'building'
            }
            onClick={handleReindex}
            type="button"
          >
            {reindexDictionary.isPending && <RefreshCw className="animate-spin" />}
            重新索引
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
