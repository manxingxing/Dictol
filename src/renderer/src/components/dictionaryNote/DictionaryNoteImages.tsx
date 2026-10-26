import { useState } from 'react'
import { X } from 'lucide-react'

import type { DictionaryNoteAttachmentItem } from '../../../../shared/dictionary-note'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'

type DictionaryNoteImage = DictionaryNoteAttachmentItem

function DictionaryNoteImagePreview({
  image,
  onClose
}: {
  image: DictionaryNoteImage
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        className="fixed left-1/2 top-1/2 z-50 flex h-fit w-fit max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-0 overflow-visible border-0 bg-transparent p-0 shadow-none"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">笔记图片预览</DialogTitle>
        <div className="relative h-fit w-fit">
          <img
            alt="笔记图片预览"
            className="block bg-background max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            src={`dictol-note://image/${image.storageKey}`}
          />
          <DialogClose
            aria-label="关闭图片预览"
            className="absolute right-2 top-2 z-10 rounded-full bg-background p-1.5 text-foreground transition-colors hover:bg-muted focus-visible:outline-none"
          >
            <X className="size-4" />
            <span className="sr-only">关闭图片预览</span>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function DictionaryNoteImages({
  images,
  className = '',
  previewable = false,
  variant = 'gallery'
}: {
  images: DictionaryNoteImage[]
  className?: string
  previewable?: boolean
  variant?: 'gallery' | 'thumbnail'
}): React.JSX.Element | null {
  const [previewImage, setPreviewImage] = useState<DictionaryNoteImage | null>(null)
  if (images.length === 0) return null
  return (
    <>
      <div
        className={`mt-3 ${variant === 'thumbnail' ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-2'} ${className}`}
      >
        {images.map((image) =>
          previewable ? (
            <button
              aria-label="放大笔记图片"
              className="block overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              key={image.id}
              onClick={() => setPreviewImage(image)}
              type="button"
            >
              <img
                alt="笔记图片缩略图"
                className={
                  variant === 'thumbnail'
                    ? 'size-16 rounded-md border border-border bg-muted object-contain cursor-pointer'
                    : 'max-h-64 w-full rounded-md border border-border object-contain object-left-top'
                }
                height={variant === 'thumbnail' ? 64 : image.height}
                loading="lazy"
                src={`dictol-note://image/${image.storageKey}`}
                width={variant === 'thumbnail' ? 64 : image.width}
              />
            </button>
          ) : (
            <img
              alt="笔记图片"
              className="max-h-64 w-full rounded-md border border-border object-contain object-left-top"
              height={image.height}
              key={image.id}
              loading="lazy"
              src={`dictol-note://image/${image.storageKey}`}
              width={image.width}
            />
          )
        )}
      </div>
      {previewable && previewImage && (
        <DictionaryNoteImagePreview image={previewImage} onClose={() => setPreviewImage(null)} />
      )}
    </>
  )
}
