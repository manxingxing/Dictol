import { useState } from 'react'
import { LoaderCircle, Pencil, Quote, Trash2 } from 'lucide-react'

import { hasNoteContent } from '@/components/rich-note-format'
import { Button } from '@/components/ui/button'
import {
  useDeleteNote,
  useUpdateNoteContent,
  type DictionaryNote
} from '@/hooks/use-dictionary-note'
import { formatTime } from '@/lib/utils'
import { DictionaryNoteExcerpt } from './DictionaryNoteExcerpt'
import { DictionaryNoteImages } from './DictionaryNoteImages'
import { RichNoteContent } from './RichNoteContent'
import { RichNoteEditor } from './RichNoteEditor'

type Props =
  | {
      note: DictionaryNote
      variant: 'timeline'
      onOpenSearchExplanation: (term: string) => void
    }
  | {
      note: DictionaryNote
      variant: 'word-group'
      separator?: boolean
    }

export function ExcerptNoteRecord(props: Props): React.JSX.Element {
  const { note } = props
  const isTimeline = props.variant === 'timeline'
  const [editing, setEditing] = useState(false)
  const [comment, setComment] = useState({ text: note.comment ?? '', rich: note.commentRich })
  const saveComment = useUpdateNoteContent(() => setEditing(false))
  const deleteNote = useDeleteNote()

  const save = (): void => {
    const hasComment = hasNoteContent(comment.text, comment.rich)
    saveComment.mutate({
      noteId: note.id,
      content: {
        comment: hasComment ? comment.text : null,
        commentRich: hasComment ? comment.rich : null
      }
    })
  }

  const cancelEditing = (): void => {
    setComment({ text: note.comment ?? '', rich: note.commentRich })
    setEditing(false)
    saveComment.reset()
  }

  const confirmDelete = (): void => {
    if (window.confirm('删除整条摘抄和笔记？此操作不可撤销。')) deleteNote.mutate(note.id)
  }

  const actions = (
    <div className="flex shrink-0 items-center gap-2">
      <time dateTime={note.createdAt}>{formatTime(note.createdAt)}</time>
      <Button
        aria-label="编辑笔记"
        className="size-7"
        disabled={deleteNote.isPending}
        onClick={() => {
          setComment({ text: note.comment ?? '', rich: note.commentRich })
          setEditing(true)
        }}
        size="icon"
        title="编辑笔记"
        type="button"
        variant="ghost"
      >
        <Pencil className="size-3.5" />
      </Button>
      <Button
        aria-label="删除整条摘抄和笔记"
        className="size-7"
        disabled={deleteNote.isPending}
        onClick={confirmDelete}
        size="icon"
        title="删除整条摘抄和笔记"
        type="button"
        variant="ghost"
      >
        {deleteNote.isPending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
      </Button>
    </div>
  )

  const Container = isTimeline ? 'article' : 'div'

  return (
    <Container
      className={
        isTimeline
          ? 'rounded-xl border border-border bg-card p-3 pb-2'
          : `group/record relative my-1 py-2 ${props.separator ? 'border-t border-border' : ''} ${editing ? 'pb-3' : ''}`
      }
    >
      {props.variant === 'timeline' && note.relatedTerms.length > 0 && (
        <div
          aria-label="关联单词"
          className="mb-3 flex flex-wrap justify-start gap-2 border-b border-border pb-2"
        >
          {note.relatedTerms.map((term) => (
            <button
              className="rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 cursor-pointer"
              key={term}
              onClick={() => props.onOpenSearchExplanation(term)}
              title={`查词：${term}`}
              type="button"
            >
              {term}
            </button>
          ))}
        </div>
      )}
      {note.excerpt && (
        <blockquote className="border-l-2 border-primary/60 pl-3 mb-3 text-[14px] leading-7">
          <DictionaryNoteExcerpt
            relatedTerms={note.relatedTerms}
            searchMatches={note.searchMatches?.excerpt}
            text={note.excerpt}
          />
        </blockquote>
      )}
      <DictionaryNoteImages images={note.attachments} previewable variant="thumbnail" />
      {editing ? (
        <form
          className={`space-y-3 ${note.excerpt || note.attachments.length > 0 ? 'mt-3' : ''}`}
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <RichNoteEditor
            className="min-h-24"
            initialValue={comment.text}
            initialRichValue={comment.rich}
            label={`编辑笔记：${note.relatedTerms.join('、') || '摘抄'}`}
            onChange={setComment}
            placeholder="补充你对这段话的理解…"
            footer={
              <>
                <Button onClick={cancelEditing} size="xs" type="button" variant="outline">
                  取消
                </Button>
                <Button
                  disabled={
                    saveComment.isPending ||
                    (!note.excerpt &&
                      note.attachments.length === 0 &&
                      !hasNoteContent(comment.text, comment.rich))
                  }
                  size="xs"
                  type="submit"
                >
                  {saveComment.isPending && <LoaderCircle className="size-3.5 animate-spin" />}
                  保存
                </Button>
              </>
            }
          />
          {saveComment.isError && (
            <p className="text-sm text-destructive">保存失败：{saveComment.error.message}</p>
          )}
        </form>
      ) : (
        <>
          {note.comment ? (
            <RichNoteContent
              className={`${isTimeline && note.excerpt ? 'mt-3 ' : ''}text-foreground text-[14px] leading-7`}
              value={note.comment}
              richValue={note.commentRich}
              searchMatches={note.searchMatches?.comment}
            />
          ) : note.attachments.length === 0 ? (
            <p className={`${note.excerpt ? 'mt-3' : ''} text-sm italic text-muted-foreground`}>
              尚无笔记
            </p>
          ) : null}
          {isTimeline ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-2 text-xs text-muted-foreground">
              {note.sourceDictionaryName && (
                <div className="flex min-w-0 items-center gap-1.5">
                  <Quote className="size-3.5 shrink-0" />
                  <span className="truncate">
                    词典 · {note.sourceDictionaryName}
                    {note.sourceEntryTerm && ` · ${note.sourceEntryTerm}`}
                  </span>
                </div>
              )}
              <div className="ml-auto">{actions}</div>
            </div>
          ) : (
            <div className="pointer-events-none absolute right-0 bottom-0 flex translate-y-1 rounded-md bg-background px-1 py-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/record:pointer-events-auto group-hover/record:opacity-100 group-focus-within/record:pointer-events-auto group-focus-within/record:opacity-100">
              {actions}
            </div>
          )}
          {deleteNote.isError && (
            <p className="mt-2 text-sm text-destructive">删除失败：{deleteNote.error.message}</p>
          )}
        </>
      )}
    </Container>
  )
}
