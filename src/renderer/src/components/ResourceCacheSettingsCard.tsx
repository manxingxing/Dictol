import { useEffect, useState } from 'react'
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
import { formatFileSize } from '@/lib/utils'

export function ResourceCacheSettingsCard(): React.JSX.Element {
  const [resourceCacheSize, setResourceCacheSize] = useState<number | null>(null)
  const [resourceCacheError, setResourceCacheError] = useState(false)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [clearError, setClearError] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isOpeningDirectory, setIsOpeningDirectory] = useState(false)

  useEffect(() => {
    void window.dictol.app
      .getResourceCacheSize()
      .then(setResourceCacheSize)
      .catch(() => setResourceCacheError(true))
  }, [])

  const confirmClearResourceCache = async (): Promise<void> => {
    setIsClearing(true)
    setClearError(false)
    try {
      await window.dictol.app.clearResourceCache()
      setResourceCacheSize(0)
      setClearDialogOpen(false)
      toast.success('资源缓存已清除')
    } catch {
      setClearError(true)
    } finally {
      setIsClearing(false)
    }
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

  const cacheSizeLabel =
    resourceCacheSize === null
      ? resourceCacheError
        ? '读取失败'
        : '读取中…'
      : formatFileSize(resourceCacheSize)

  return (
    <SettingsSection description="管理从 MDD 解压出来的本地资源。" title="存储">
      <SettingsList>
        <SettingsRow
          label="资源缓存"
          description={
            resourceCacheError
              ? '无法读取资源缓存占用空间。'
              : '清除后，词典资源会在下次使用时重新生成。'
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-sm font-medium tabular-nums">{cacheSizeLabel}</span>
              <Button
                disabled={isOpeningDirectory}
                onClick={() => void openResourceCacheDirectory()}
                size="sm"
                type="button"
                variant="outline"
              >
                {isOpeningDirectory && <LoaderCircle className="animate-spin" />}
                {!isOpeningDirectory && <FolderOpen />}
              </Button>
              <Button
                disabled={resourceCacheSize === null || resourceCacheSize === 0 || isClearing}
                onClick={() => {
                  setClearError(false)
                  setClearDialogOpen(true)
                }}
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
      </SettingsList>

      <Dialog
        onOpenChange={(open) => {
          if (!isClearing) setClearDialogOpen(open)
        }}
        open={clearDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清除资源缓存？</DialogTitle>
            <DialogDescription>
              这会删除已解压的词典资源，释放{' '}
              {resourceCacheSize === null ? '当前' : formatFileSize(resourceCacheSize)} 存储空间。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-6">
            词典文件、词条数据和设置不会受到影响。下次使用相关资源时，Dictol 会按需重新解压。
          </p>
          {clearError && <p className="text-sm text-destructive">清除资源缓存失败，请重试。</p>}
          <DialogFooter>
            <Button
              disabled={isClearing}
              onClick={() => setClearDialogOpen(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={isClearing}
              onClick={() => void confirmClearResourceCache()}
              type="button"
              variant="destructive"
            >
              {isClearing && <LoaderCircle className="animate-spin" />}
              清除缓存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
