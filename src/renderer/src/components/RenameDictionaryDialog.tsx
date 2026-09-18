import { useEffect, useState } from 'react'
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
import { useUpdateDictionaryName } from '@/hooks/use-dictionaries'

export interface RenameDictionaryDialogProps {
  dictionary: { id: string; name: string } | null
  onOpenChange: (open: boolean) => void
}

export function RenameDictionaryDialog({
  dictionary,
  onOpenChange
}: RenameDictionaryDialogProps): React.JSX.Element {
  const { reset, mutateAsync, isPending, isError, error } = useUpdateDictionaryName()
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!dictionary) return
    reset()
    setValue(dictionary.name)
  }, [dictionary, reset])

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!dictionary) return
    void mutateAsync({ dictionaryId: dictionary.id, name: value })
      .then(() => onOpenChange(false))
      .catch(() => undefined) // error will be displayed in page
  }

  return (
    <Dialog
      open={dictionary !== null}
      onOpenChange={(open) => {
        if (!open && isPending) return
        onOpenChange(open)
      }}
    >
      <DialogContent>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>修改词典名称</DialogTitle>
            <DialogDescription>为「{dictionary?.name}」输入新名称。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              autoFocus
              id="dictionary-name"
              maxLength={100}
              onChange={(event) => setValue(event.target.value)}
              placeholder={dictionary?.name}
              value={value}
            />
          </div>
          {isError && <p className="text-sm text-destructive">{error.message}</p>}
          <DialogFooter>
            <Button
              disabled={isPending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button disabled={!value.trim() || isPending} type="submit">
              {isPending ? '正在保存…' : '保存名称'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
