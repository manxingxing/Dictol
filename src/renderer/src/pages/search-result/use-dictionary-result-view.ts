import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DictionaryEntryGroup } from '@/hooks/use-dictionary-entries'
import { DICTIONARY_ENTRY_ANCHOR_PARAM } from '../../../../shared/dictionary-navigation'

export type DictionaryResultProps = {
  term: string
  anchor?: string
  dictionaries: NonNullable<DictionaryEntryGroup>['dictionaries']
  isFetching: boolean
  isPlaceholderData: boolean
  groupId: string | null
  actions: ReactNode
}

// Shared native surface plumbing; loading targets and navigation state belong
// to the individual result components.
export function useDictionaryResultView(): {
  contentRef: (node: HTMLDivElement | null) => void
  loading: boolean
} {
  const [container, contentRef] = useState<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => window.dictol.dictionaryView.onLoadingChanged(setLoading), [])
  useEffect(() => () => window.dictol.dictionaryView.hide(), [])
  useLayoutEffect(() => {
    if (!container) return
    let frame = 0
    const update = (): void => {
      const { x, y, width, height } = container.getBoundingClientRect()
      window.dictol.dictionaryView.setBounds({ x, y, width, height })
    }
    const schedule = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        update()
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    update()
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [container])
  return { contentRef, loading }
}

// entry://, 'lookup button in context menu'
export function useDictionaryWordNavigation(dictionaryId?: string): void {
  const navigate = useNavigate()
  useEffect(() =>
      window.dictol.dictionaryView.onLookupWord(({ word: value, sourceDictionaryId, anchor }) => {
        const word = value.trim()
        if (!word) return
        const params = new URLSearchParams()
        const targetId = sourceDictionaryId ?? dictionaryId
        if (targetId) {
          params.set('dictionaryId', targetId)
          params.set('focusDictionaryId', targetId)
        }
        if (anchor) params.set(DICTIONARY_ENTRY_ANCHOR_PARAM, anchor)
        const query = params.toString() ? `?${params}` : ''
        void navigate(`/search/${encodeURIComponent(word)}${query}`)
      }),
    [dictionaryId, navigate]
  )
}
