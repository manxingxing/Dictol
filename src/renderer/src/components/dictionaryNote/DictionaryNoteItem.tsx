import { useState } from 'react'
import { NotebookPen, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DictionaryNoteExcerpt } from '@/components/dictionaryNote/DictionaryNoteExcerpt'
import { DictionaryNoteImages } from '@/components/dictionaryNote/DictionaryNoteImages'
import { RichNoteContent } from '@/components/dictionaryNote/RichNoteContent'
import { RichNoteEditor } from '@/components/dictionaryNote/RichNoteEditor'
import { hasNoteContent } from '@/components/rich-note-format'
import {
  useDeleteNoteForTerm,
  useUpdateNoteContentForTerm,
  type DictionaryNote
} from '@/hooks/use-dictionary-note'
import { formatNoteDate } from '@/lib/utils'

export function DictionaryNoteItem({
  note,
  term
}: {
  note: DictionaryNote
  term: string
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [comment, setComment] = useState({ text: note.comment ?? '', rich: note.commentRich })
  const deleteNote = useDeleteNoteForTerm(term)
  const updateContent = useUpdateNoteContentForTerm(term)
  const emptyNote =
    !note.excerpt?.trim() &&
    note.attachments.length === 0 &&
    !hasNoteContent(comment.text, comment.rich)

  return (
    <article className="group select-text p-3">
      {note.excerpt && (
        <blockquote className="border-l-2 border-primary/60 pl-3 text-sm leading-6">
          <DictionaryNoteExcerpt relatedTerms={note.relatedTerms} text={note.excerpt} />
        </blockquote>
      )}
      <DictionaryNoteImages images={note.attachments} />
      {editing ? (
        <>
          <RichNoteEditor
            className="mt-2"
            initialValue={comment.text}
            initialRichValue={comment.rich}
            label="编辑笔记"
            onChange={setComment}
            placeholder="笔记内容"
            footer={
              <>
                <Button
                  onClick={() => {
                    updateContent.reset()
                    setEditing(false)
                  }}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  取消
                </Button>
                <Button
                  disabled={updateContent.isPending || emptyNote}
                  onClick={() => {
                    const hasComment = hasNoteContent(comment.text, comment.rich)
                    updateContent.mutate(
                      {
                        noteId: note.id,
                        content: {
                          comment: hasComment ? comment.text : null,
                          commentRich: hasComment ? comment.rich : null
                        }
                      },
                      { onSuccess: () => setEditing(false) }
                    )
                  }}
                  size="xs"
                  type="button"
                >
                  保存
                </Button>
              </>
            }
          />
          {updateContent.isError && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              保存失败：{updateContent.error.message}
            </p>
          )}
        </>
      ) : note.comment ? (
        <RichNoteContent
          className="mt-2 text-sm leading-6 text-foreground"
          value={note.comment}
          richValue={note.commentRich}
        />
      ) : null}
      {!editing && (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {note.sourceDictionaryName ?? '单词笔记'} · {formatNoteDate(note.createdAt)}
          </span>
          <span className="flex opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              aria-label={note.comment !== null ? '编辑笔记' : '添加笔记'}
              className="size-6"
              onClick={() => {
                updateContent.reset()
                setComment({ text: note.comment ?? '', rich: note.commentRich })
                setEditing(true)
              }}
              size="icon"
              title={note.comment !== null ? '编辑笔记' : '添加笔记'}
              type="button"
              variant="ghost"
            >
              <NotebookPen className="size-3.5" />
            </Button>
            <Button
              aria-label="删除笔记"
              className="size-6"
              disabled={deleteNote.isPending}
              onClick={() => deleteNote.mutate(note.id)}
              size="icon"
              title="删除笔记"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          </span>
        </div>
      )}
    </article>
  )
}
