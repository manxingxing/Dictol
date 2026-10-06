import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
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
import { useRenameWordbook } from '@/hooks/use-wordbooks'

type WordbookTarget = { id: string; name: string }

export function RenameWordbookDialog({
  onOpenChange,
  wordbook
}: {
  onOpenChange: (open: boolean) => void
  wordbook: WordbookTarget | null
}): React.JSX.Element {
  const [name, setName] = useState(wordbook?.name ?? '')
  const renameWordbook = useRenameWordbook()

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!wordbook || !name.trim()) return
    renameWordbook.mutate(
      { wordbookId: wordbook.id, name: name.trim() },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast.success('重命名成功')
        },
        onError: (error) => toast.error(error.message)
      }
    )
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={true}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重命名生词本</DialogTitle>
          <DialogDescription>为「{wordbook?.name}」输入新名称。</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <Input
            autoFocus
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          {renameWordbook.isError && (
            <p className="text-sm text-destructive">{renameWordbook.error.message}</p>
          )}
          <DialogFooter>
            <Button
              disabled={
                !name.trim() || name.trim() === wordbook?.name || renameWordbook.isPending
              }
              type="submit"
            >
              {renameWordbook.isPending && <LoaderCircle className="animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
