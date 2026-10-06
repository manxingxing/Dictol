import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useDeleteWordbook } from '@/hooks/use-wordbooks'

type WordbookTarget = { id: string; name: string }

export function DeleteWordbookDialog({
  onOpenChange,
  wordbook
}: {
  onOpenChange: (open: boolean) => void
  wordbook: WordbookTarget | null
}): React.JSX.Element {
  const deleteWordbook = useDeleteWordbook()
  const navigate = useNavigate()
  const location = useLocation()

  const confirmDelete = (): void => {
    if (!wordbook) return
    deleteWordbook.mutate(wordbook.id, {
      onSuccess: () => {
        onOpenChange(false)
        toast.success('生词本已删除')
        if (location.pathname === `/wordbooks/${wordbook.id}`) {
          navigate('/wordbooks')
        }
      },
      onError: (error) => toast.error(error.message)
    })
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={true}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>
            将删除生词本「{wordbook?.name}」及其所有单词，此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={deleteWordbook.isPending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button
            disabled={deleteWordbook.isPending}
            onClick={confirmDelete}
            type="button"
            variant="destructive"
          >
            {deleteWordbook.isPending && <LoaderCircle className="animate-spin" />}
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
