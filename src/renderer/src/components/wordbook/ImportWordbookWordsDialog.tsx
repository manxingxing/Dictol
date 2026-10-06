import { useState } from 'react'
import { LoaderCircle, Upload } from 'lucide-react'
import { toast } from 'sonner'

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
import { useImportWordbookWords, useWordbooks } from '@/hooks/use-wordbooks'

export function ImportWordbookWordsDialog({
  wordbookId,
  onImported
}: {
  wordbookId?: string
  onImported: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const importWordbookWords = useImportWordbookWords()
  const { data: wordbooks = [] } = useWordbooks()

  const importTargetName = wordbookId
    ? (wordbooks.find((wordbook) => wordbook.id === wordbookId)?.name ?? '生词本')
    : (wordbooks.find((wordbook) => wordbook.isDefault)?.name ?? '默认生词本')

  const submit = (): void => {
    if (!text.trim()) return

    importWordbookWords.mutate(
      { text, wordbookId },
      {
        onSuccess: (result) => {
          toast.success(`已导入 ${result.imported} 个单词到“${result.wordbookName}”`)
          setText('')
          setOpen(false)
          onImported()
        }
      }
    )
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (importWordbookWords.isPending) return
        if (nextOpen) {
          setText('')
          importWordbookWords.reset()
        }
        setOpen(nextOpen)
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button disabled={importWordbookWords.isPending} size="sm" type="button" variant="outline">
          <Upload />
          导入
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>导入单词</DialogTitle>
          <DialogDescription>
            每行输入一个单词，将导入到“{importTargetName}”生词本。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-2 text-sm font-medium" htmlFor="wordbook-import-words">
            单词列表
            <textarea
              autoFocus
              className="min-h-56 w-full resize-y rounded-lg border border-input px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={importWordbookWords.isPending}
              id="wordbook-import-words"
              onChange={(event) => setText(event.target.value)}
              placeholder={'running\nbeautiful\nexample'}
              spellCheck={false}
              value={text}
            />
          </label>
          {importWordbookWords.isError && (
            <p className="text-sm text-destructive">{importWordbookWords.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={!text.trim() || importWordbookWords.isPending}
            onClick={submit}
            type="button"
          >
            {importWordbookWords.isPending && <LoaderCircle className="animate-spin" />}
            {importWordbookWords.isPending ? '正在导入' : '导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
