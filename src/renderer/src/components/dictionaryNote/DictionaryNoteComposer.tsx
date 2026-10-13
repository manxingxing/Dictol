import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { RichNoteEditor } from '@/components/dictionaryNote/RichNoteEditor'
import { useCreateDictionaryNote } from '@/hooks/use-dictionary-note'

type ComposerImage = { id: string; file: File; previewUrl: string }

export function DictionaryNoteComposer({ term }: { term: string }): React.JSX.Element {
  const [comment, setComment] = useState({ text: '', rich: null as string | null })
  const [editorResetKey, setEditorResetKey] = useState(0)
  const [images, setImages] = useState<ComposerImage[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const imagesRef = useRef<ComposerImage[]>([])
  const createNote = useCreateDictionaryNote(term)
  const hasComment = comment.text.length > 0

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl))
    }
  }, [])

  const handlePasteImage = (event: globalThis.ClipboardEvent): boolean => {
    if (!event.clipboardData) return false
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return false
    setErrorMessage(null)
    const nextImages = [...imagesRef.current]
    for (const file of files) {
      if (nextImages.length >= 10) {
        setErrorMessage('一条笔记最多添加 10 张图片')
        break
      }
      if (file.size > 20 * 1024 * 1024) {
        setErrorMessage('图片不能超过 20 MB')
        break
      }
      if (file.size === 0) {
        setErrorMessage('图片为空')
        break
      }
      nextImages.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file)
      })
    }
    imagesRef.current = nextImages
    setImages(nextImages)
    return true
  }

  const removeImage = (id: string): void => {
    const image = imagesRef.current.find((item) => item.id === id)
    if (image) URL.revokeObjectURL(image.previewUrl)
    imagesRef.current = imagesRef.current.filter((item) => item.id !== id)
    setImages(imagesRef.current)
  }

  const save = (): void => {
    createNote.mutate(
      {
        comment: hasComment ? comment.text : null,
        commentRich: hasComment ? comment.rich : null,
        images: images.map((image) => image.file)
      },
      {
        onSuccess: () => {
          setComment({ text: '', rich: null })
          setEditorResetKey((key) => key + 1)
          imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl))
          imagesRef.current = []
          setImages([])
          setErrorMessage(null)
        },
        onError: (error) =>
          setErrorMessage(error instanceof Error ? error.message : '保存笔记失败，请重试。')
      }
    )
  }

  return (
    <div className="shrink-0 border-t border-border bg-[var(--surface-secondary)] p-3">
      <div className="rounded-md border border-border bg-background p-1 focus-within:border-primary/60">
        {images.length > 0 && (
          <div className="m-1 flex flex-wrap gap-2">
            {images.map((image) => (
              <div className="relative" key={image.id}>
                <img
                  alt="待添加的笔记图片"
                  className="size-16 rounded border border-border object-cover"
                  src={image.previewUrl}
                />
                <Button
                  aria-label="移除待添加图片"
                  className="absolute -right-1.5 -top-1.5 size-5 rounded-full bg-background shadow"
                  onClick={() => removeImage(image.id)}
                  disabled={createNote.isPending}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <RichNoteEditor
          key={editorResetKey}
          className="border-0"
          disabled={createNote.isPending}
          initialValue={comment.text}
          initialRichValue={comment.rich}
          label="摘抄笔记"
          onChange={setComment}
          onPaste={handlePasteImage}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save()
          }}
          placeholder="写下这个单词的笔记"
        />
      </div>
      {errorMessage && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          支持粘贴图片 · ⌘/Ctrl + Enter 提交
        </span>
        <Button
          disabled={createNote.isPending || (!hasComment && images.length === 0)}
          onClick={save}
          size="sm"
          type="button"
        >
          {createNote.isPending ? '提交中…' : '提交'}
        </Button>
      </div>
    </div>
  )
}
