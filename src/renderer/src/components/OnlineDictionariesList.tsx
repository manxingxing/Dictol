import { useState } from 'react'
import { GripVertical, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DictionaryAvatar } from '@/components/DictionaryIcon'
import { OnlineDictionaryDialog } from '@/components/OnlineDictionaryDialog'
import {
  useOnlineDictionaries,
  useRemoveOnlineDictionary,
  useReorderOnlineDictionaries
} from '@/hooks/use-online-dictionaries'

export function OnlineDictionariesList(): React.JSX.Element {
  const {
    data: onlineDictionaries = [],
    isLoading: onlineLoading,
    isError: onlineError
  } = useOnlineDictionaries()
  const removeOnlineDictionary = useRemoveOnlineDictionary()
  const reorderOnlineDictionaries = useReorderOnlineDictionaries()
  const [isOnlineDictionaryDialogOpen, setIsOnlineDictionaryDialogOpen] = useState(false)
  const [draggedOnlineId, setDraggedOnlineId] = useState<string | null>(null)
  const [onlineDropTarget, setOnlineDropTarget] = useState<{
    id: string
    position: 'before' | 'after'
  } | null>(null)

  const handleRemoveDictionary = async (dictionary: {
    id: string
    name: string
  }): Promise<void> => {
    if (!window.confirm(`确定删除“${dictionary.name}”吗？`)) return

    try {
      await removeOnlineDictionary.mutateAsync(dictionary.id)
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : '请稍后重试。'
      })
    }
  }

  const handleReorderDictionaries = async (nextOrder: string[]): Promise<void> => {
    try {
      await reorderOnlineDictionaries.mutateAsync(nextOrder)
    } catch (error) {
      toast.error('排序保存失败', {
        description: error instanceof Error ? error.message : '请稍后重试。'
      })
    }
  }

  const finishOnlineDragging = (): void => {
    setDraggedOnlineId(null)
    setOnlineDropTarget(null)
  }

  return (
    <section className="pt-6">
      <div className="mb-3 flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-5">在线词典</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            配置常用网站，在查词结果旁并排查看在线词典内容。
          </p>
        </div>
        <Button
          aria-label="添加在线词典"
          className="shrink-0"
          onClick={() => setIsOnlineDictionaryDialogOpen(true)}
          size="sm"
          title="添加在线词典"
          type="button"
          variant="outline"
        >
          <Plus />
          添加在线词典
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
        {onlineLoading && (
          <p className="bg-card px-4 py-5 text-sm text-muted-foreground">正在加载…</p>
        )}
        {onlineError && (
          <p className="bg-card px-4 py-5 text-sm text-destructive">
            加载在线词典失败，请稍后重试。
          </p>
        )}
        {!onlineLoading && !onlineError && onlineDictionaries.length === 0 && (
          <p className="bg-card px-4 py-5 text-sm text-muted-foreground">
            还没有配置在线词典。
          </p>
        )}
        {!onlineLoading && !onlineError && onlineDictionaries.length > 0 && (
          <ul className="divide-y divide-border">
            {onlineDictionaries.map((dictionary) => {
              const isDeleting =
                removeOnlineDictionary.isPending &&
                removeOnlineDictionary.variables === dictionary.id
              return (
                <li
                  className={`flex min-h-16 items-center gap-3 bg-card px-4 py-3 transition-[background-color,opacity] hover:bg-muted/40 ${
                    draggedOnlineId === dictionary.id ? 'opacity-45' : ''
                  } ${
                    onlineDropTarget?.id === dictionary.id
                      ? onlineDropTarget.position === 'before'
                        ? 'border-t-2 border-t-primary'
                        : 'border-b-2 border-b-primary'
                      : ''
                  }`}
                  key={dictionary.id}
                  onDragOver={(event) => {
                    if (!draggedOnlineId || draggedOnlineId === dictionary.id) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    const bounds = event.currentTarget.getBoundingClientRect()
                    setOnlineDropTarget({
                      id: dictionary.id,
                      position:
                        event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                    })
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (!draggedOnlineId) return
                    const bounds = event.currentTarget.getBoundingClientRect()
                    const position =
                      event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                    const nextOrder = onlineDictionaries
                      .map((item) => item.id)
                      .filter((id) => id !== draggedOnlineId)
                    let targetIndex = nextOrder.indexOf(dictionary.id)
                    if (targetIndex < 0) return
                    if (position === 'after') targetIndex += 1
                    nextOrder.splice(targetIndex, 0, draggedOnlineId)
                    finishOnlineDragging()
                    void handleReorderDictionaries(nextOrder)
                  }}
                >
                  <button
                    aria-label={`拖动排序 ${dictionary.name}`}
                    className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                    disabled={reorderOnlineDictionaries.isPending}
                    draggable={!reorderOnlineDictionaries.isPending}
                    onDragEnd={finishOnlineDragging}
                    onDragStart={(event) => {
                      setDraggedOnlineId(dictionary.id)
                      setOnlineDropTarget(null)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', dictionary.id)
                    }}
                    type="button"
                  >
                    <GripVertical className="size-4" />
                  </button>
                  <DictionaryAvatar iconUrl={dictionary.faviconUrl} name={dictionary.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{dictionary.name}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {dictionary.urlTemplate}
                    </p>
                  </div>
                  <Button
                    aria-label={`删除在线词典 ${dictionary.name}`}
                    className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    disabled={removeOnlineDictionary.isPending}
                    onClick={ () => handleRemoveDictionary(dictionary) }
                    size="icon"
                    title="删除在线词典"
                    type="button"
                    variant="ghost"
                  >
                    {isDeleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {isOnlineDictionaryDialogOpen && (
        <OnlineDictionaryDialog onClose={() => setIsOnlineDictionaryDialogOpen(false)} />
      )}
    </section>
  )
}
