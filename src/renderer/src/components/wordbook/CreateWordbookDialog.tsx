import { useState } from 'react'
import { LoaderCircle, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCreateWordbook } from '@/hooks/use-wordbooks'

export function CreateWordbookDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const createWordbook = useCreateWordbook()
  const navigate = useNavigate()

  const submit = (): void => {
    createWordbook.mutate(name, {
      onSuccess: (created) => {
        setName('')
        onOpenChange(false)
        navigate(`/wordbooks/${created.id}`)
      }
    })
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button
          aria-label="新建生词本"
          size="sm"
          title="新建生词本"
          type="button"
          variant="ghost"
        >
          <Plus />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建生词本</DialogTitle>
          <DialogDescription>为单词创建一个新的分类生词本。</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Input
            autoFocus
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：托福核心词"
            value={name}
          />
          {createWordbook.isError && (
            <p className="text-sm text-destructive">{createWordbook.error.message}</p>
          )}
          <DialogFooter>
            <Button disabled={!name.trim() || createWordbook.isPending} type="submit">
              {createWordbook.isPending && <LoaderCircle className="animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
