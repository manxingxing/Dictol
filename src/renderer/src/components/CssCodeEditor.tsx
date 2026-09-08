import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { cssLanguage } from '@codemirror/lang-css'
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

type CssCodeEditorProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  placeholder?: string
  ariaLabel?: string
  autoFocus?: boolean
  className?: string
}

const editorTheme = EditorView.theme({
  '&': {
    minHeight: '18rem',
    maxHeight: 'min(55vh, 32rem)',
    overflow: 'hidden',
    border: '1px solid var(--input)',
    borderRadius: '0.5rem',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '12px'
  },
  '&.cm-focused': {
    outline: '2px solid color-mix(in oklch, var(--ring) 30%, transparent)',
    outlineOffset: '0'
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    lineHeight: '1.65'
  },
  '.cm-content': {
    minHeight: '18rem',
    padding: '10px 0',
    caretColor: 'var(--foreground)'
  },
  '.cm-line': {
    padding: '0 12px'
  },
  '.cm-gutters': {
    borderRight: '1px solid var(--border)',
    backgroundColor: 'color-mix(in oklch, var(--muted) 60%, var(--background))',
    color: 'var(--muted-foreground)'
  },
  '.cm-gutterElement': {
    padding: '0 8px 0 10px'
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 55%, transparent)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 30%, transparent)'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)'
  },
  '.cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 22%, transparent)',
    outline: '1px solid color-mix(in oklch, var(--primary) 55%, transparent)'
  }
})

const cssHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  {
    tag: [tags.tagName, tags.className, tags.labelName],
    color: 'var(--primary)'
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: 'light-dark(oklch(0.48 0.16 255), oklch(0.76 0.11 250))'
  },
  {
    tag: [tags.string, tags.color, tags.url],
    color: 'light-dark(oklch(0.44 0.12 145), oklch(0.77 0.12 145))'
  },
  {
    tag: [tags.number, tags.integer, tags.float, tags.unit],
    color: 'light-dark(oklch(0.5 0.14 60), oklch(0.78 0.13 70))'
  },
  {
    tag: [tags.keyword, tags.bool, tags.atom],
    color: 'light-dark(oklch(0.48 0.16 320), oklch(0.76 0.12 320))'
  },
  { tag: [tags.operator, tags.punctuation], color: 'var(--muted-foreground)' },
  { tag: tags.invalid, color: 'oklch(0.62 0.22 25)', textDecoration: 'underline wavy' }
])

export default function CssCodeEditor({
  id,
  value,
  onChange,
  maxLength = 200_000,
  placeholder: placeholderText,
  ariaLabel = 'CSS 内容',
  autoFocus = false,
  className
}: CssCodeEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const initialValueRef = useRef(value)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(cssHighlightStyle),
      cssLanguage,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      editorTheme,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ id: id ?? '', 'aria-label': ariaLabel }),
      EditorState.transactionFilter.of((transaction) =>
        transaction.newDoc.length <= maxLength ? transaction : []
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
      })
    ]
    if (placeholderText) extensions.push(placeholder(placeholderText))

    const view = new EditorView({
      state: EditorState.create({ doc: initialValueRef.current, extensions }),
      parent: container
    })
    viewRef.current = view
    const focusFrame = autoFocus ? requestAnimationFrame(() => view.focus()) : 0

    return () => {
      if (focusFrame) cancelAnimationFrame(focusFrame)
      viewRef.current = null
      view.destroy()
    }
  }, [ariaLabel, autoFocus, id, maxLength, placeholderText])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  return <div ref={containerRef} className={className} />
}
