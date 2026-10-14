import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

type NoteValue = { text: string; rich: string | null }

function documentFromValue(value: NoteValue): JSONContent | string {
  if (value.rich) {
    try {
      const parsed = JSON.parse(value.rich) as JSONContent
      if (parsed.type === 'doc') return parsed
    } catch {
      // Fall back to the note's saved plain text when rich JSON is invalid.
    }
  }
  return {
    type: 'doc',
    content: value.text
      .split('\n')
      .map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
  }
}

export function RichNoteEditor({
  initialValue,
  initialRichValue = null,
  label,
  placeholder,
  disabled = false,
  className = '',
  footer,
  onChange,
  onPaste,
  onKeyDown
}: {
  initialValue: string
  initialRichValue?: string | null
  label: string
  placeholder: string
  disabled?: boolean
  className?: string
  footer?: ReactNode
  onChange: (value: NoteValue) => void
  onPaste?: (event: globalThis.ClipboardEvent) => boolean | void
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}): React.JSX.Element {
  const onChangeRef = useRef(onChange)
  const onPasteRef = useRef(onPaste)
  const onKeyDownRef = useRef(onKeyDown)
  const lastEmitted = useRef<NoteValue | null>(null)

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder })],
    content: documentFromValue({ text: initialValue, rich: initialRichValue }),
    editable: !disabled,
    editorProps: {
      attributes: {
        'aria-label': label,
        class:
          'rich-note-editor min-h-12 max-h-56 overflow-y-auto px-1 py-1 text-sm leading-6 outline-none'
      },
      handlePaste: (_view, event) => onPasteRef.current?.(event) === true,
      handleKeyDown: (_view, event) => {
        onKeyDownRef.current?.(event as unknown as KeyboardEvent<HTMLDivElement>)
        return false
      }
    },
    onUpdate: ({ editor: current }) => {
      const text = current.getText({ blockSeparator: '\n' }).trim()
      const rich = text ? JSON.stringify(current.getJSON()) : null
      const next = { text, rich }
      lastEmitted.current = next
      onChangeRef.current(next)
    }
  })

  useEffect(() => {
    onChangeRef.current = onChange
    onPasteRef.current = onPaste
    onKeyDownRef.current = onKeyDown
  }, [onChange, onPaste, onKeyDown])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    if (!editor) return
    const incoming = { text: initialValue, rich: initialRichValue }
    if (lastEmitted.current?.text === incoming.text && lastEmitted.current.rich === incoming.rich)
      return
    const currentText = editor.getText({ blockSeparator: '\n' }).trim()
    const currentRich = currentText ? JSON.stringify(editor.getJSON()) : null
    if (currentText !== incoming.text || (incoming.rich && currentRich !== incoming.rich)) {
      editor.commands.setContent(documentFromValue(incoming), { emitUpdate: false })
      lastEmitted.current = null
    }
  }, [editor, initialValue, initialRichValue])

  return (
    <div
      className={`overflow-hidden rounded-md border border-input bg-background focus-within:border-primary/60 ${className}`}
    >
      <EditorContent editor={editor} />
      {footer && <div className="flex justify-end gap-2 px-2 pb-2 pt-1">{footer}</div>}
    </div>
  )
}
