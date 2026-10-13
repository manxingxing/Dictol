import type { ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { renderToReactElement } from '@tiptap/static-renderer/pm/react'

import { DictionaryNoteSearchHighlight } from '@/components/dictionaryNote/DictionaryNoteSearchHighlight'
import { safeHref } from '@/components/rich-note-format'

export function RichNoteContent({
  value,
  richValue,
  className = '',
  searchMatches = []
}: {
  value: string
  richValue?: string | null
  className?: string
  searchMatches?: string[]
}): React.JSX.Element {
  let content: ReactNode = null
  if (richValue) {
    try {
      const document = JSON.parse(richValue) as JSONContent
      if (document?.type === 'doc') {
        content = renderToReactElement({
          content: document,
          extensions: [StarterKit],
          options: {
            markMapping: {
              link: ({ mark, children }) => {
                const href = safeHref(String(mark.attrs.href ?? ''))
                return href ? <a href={href}>{children}</a> : <span>{children}</span>
              }
            },
            ...(searchMatches.length > 0 && {
              nodeMapping: {
                text: ({ node }) => (
                  <DictionaryNoteSearchHighlight matches={searchMatches} text={node.text ?? ''} />
                )
              }
            })
          }
        })
      }
    } catch {
      // Keep the plain-text view available if a rich payload cannot be rendered.
    }
  }
  if (content !== null) return <div className={`rich-note-content ${className}`}>{content}</div>
  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {searchMatches.length > 0 ? (
        <DictionaryNoteSearchHighlight matches={searchMatches} text={value} />
      ) : (
        value
      )}
    </div>
  )
}
