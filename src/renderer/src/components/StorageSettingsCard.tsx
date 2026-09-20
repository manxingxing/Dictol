import { useState } from 'react'
import { FolderOpen, LoaderCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
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
  useClearResourceCache,
  useClearViewCache,
  useResourceCacheSize,
  useViewCacheSize
} from '@/hooks/use-app'
import { formatFileSize } from '@/lib/utils'

type ClearTarget = 'resource' | 'view'

const clearCopy: Record<
  ClearTarget,
  { title: string; detail: string; success: string; failure: string }
> = {
  resource: {
    title: '清除资源缓存？',
    detail: '词典文件、词条数据和设置不会受到影响。下次使用相关资源时，Dictol 会按需重新解压。',
    success: '资源缓存已清除',
    failure: '清除资源缓存失败，请重试。'
  },
  view: {
    title: '清除页面缓存？',
    detail:
      '词典文件、Cookie、登录状态和设置不会受到影响。已打开的页面不会重新加载，再次访问时会重新请求。',
    success: '页面缓存已清除',
    failure: '清除页面缓存失败，请重试。'
  }
}

const describeCacheSize = (size: number | undefined, isError: boolean): string =>
  isError ? '读取失败' : size === undefined ? '读取中…' : formatFileSize(size)

type CacheSettingsRowProps = {
  label: string
  description: string
  sizeLabel: string
  canClear: boolean
  isClearing: boolean
  onClear: () => void
  directory?: { isOpening: boolean; open: () => void }
}

function CacheSettingsRow({
  label,
  description,
  sizeLabel,
  canClear,
  isClearing,
  onClear,
  directory
}: CacheSettingsRowProps): React.JSX.Element {
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm font-medium tabular-nums">{sizeLabel}</span>
          {directory && (
            <Button
              aria-label="打开缓存文件夹"
              disabled={directory.isOpening}
              onClick={directory.open}
              size="sm"
              type="button"
              variant="outline"
            >
              {directory.isOpening ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
            </Button>
          )}
          <Button
            disabled={!canClear || isClearing}
            onClick={onClear}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trash2 />
            清除缓存
          </Button>
        </div>
      }
    />
  )
}

export function StorageSettingsCard(): React.JSX.Element {
  const resourceCache = useResourceCacheSize()
  const viewCache = useViewCacheSize()
  const clearResourceCache = useClearResourceCache()
  const clearViewCache = useClearViewCache()
  const [clearTarget, setClearTarget] = useState<ClearTarget | null>(null)
  const [isOpeningDirectory, setIsOpeningDirectory] = useState(false)

  const activeClear = clearTarget === 'resource' ? clearResourceCache : clearViewCache
  const activeSize = clearTarget === 'resource' ? resourceCache.data : viewCache.data
  // Radix unmounts the dialog content while closed, so the fallback entry is never shown.
  const activeCopy = clearCopy[clearTarget ?? 'resource']

  const requestClear = (target: ClearTarget): void => {
    clearResourceCache.reset()
    clearViewCache.reset()
    setClearTarget(target)
  }

  const confirmClear = (): void => {
    if (clearTarget === null) return
    activeClear.mutate(undefined, {
      onSuccess: () => {
        setClearTarget(null)
        toast.success(activeCopy.success)
      }
    })
  }

  const openResourceCacheDirectory = async (): Promise<void> => {
    setIsOpeningDirectory(true)
    try {
      await window.dictol.app.openResourceCacheDirectory()
    } catch (error) {
      toast.error('无法打开资源缓存文件夹', {
        description: error instanceof Error ? error.message : '请稍后重试。'
      })
    } finally {
      setIsOpeningDirectory(false)
    }
  }

  return (
    <SettingsSection description="管理词典资源缓存与查词页面的页面缓存。" title="存储">
      <SettingsList>
        <CacheSettingsRow
          label="资源缓存"
          description={
            resourceCache.isError
              ? '无法读取资源缓存占用空间。'
              : '从MDD文件中解压的音频、字体、图片等资源'
          }
          sizeLabel={describeCacheSize(resourceCache.data, resourceCache.isError)}
          canClear={resourceCache.data !== undefined && resourceCache.data > 0}
          isClearing={clearResourceCache.isPending}
          onClear={() => requestClear('resource')}
          directory={{
            isOpening: isOpeningDirectory,
            open: () => void openResourceCacheDirectory()
          }}
        />
        <CacheSettingsRow
          label="页面缓存"
          description={
            viewCache.isError
              ? '无法读取页面缓存占用空间。'
              : '查词释义视图与内置浏览器请求过的网页资源'
          }
          sizeLabel={describeCacheSize(viewCache.data, viewCache.isError)}
          canClear={viewCache.data !== undefined}
          isClearing={clearViewCache.isPending}
          onClear={() => requestClear('view')}
        />
      </SettingsList>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !activeClear.isPending) setClearTarget(null)
        }}
        open={clearTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activeCopy.title}</DialogTitle>
            <DialogDescription>
              这会释放{' '}
              {activeSize === undefined ? '当前' : formatFileSize(activeSize)} 存储空间。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-6">{activeCopy.detail}</p>
          {activeClear.isError && (
            <p className="text-sm text-destructive">{activeCopy.failure}</p>
          )}
          <DialogFooter>
            <Button
              disabled={activeClear.isPending}
              onClick={() => setClearTarget(null)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={activeClear.isPending}
              onClick={confirmClear}
              type="button"
            >
              {activeClear.isPending && <LoaderCircle className="animate-spin" />}
              清除缓存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
