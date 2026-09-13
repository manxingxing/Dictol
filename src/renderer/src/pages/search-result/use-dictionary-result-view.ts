import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/stores/app-store'
import type { DictionaryEntryGroup } from '@/hooks/use-dictionary-entries'

export type DictionaryResultProps = {
  term: string
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

export function useDictionaryWordNavigation(dictionaryId?: string): void {
  const navigate = useNavigate()
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)
  useEffect(
    () =>
      window.dictol.dictionaryView.onLookupWord(({ word: value, sourceDictionaryId }) => {
        const word = value.trim()
        if (!word) return
        setSearchQuery(word)
        console.log({value, sourceDictionaryId})
        const params = new URLSearchParams()
        if (dictionaryId) params.set('dictionary', dictionaryId)
        else if (sourceDictionaryId) params.set('focusDictionaryId', sourceDictionaryId)
        const query = params.toString() ? `?${params}` : ''
        console.log(query)
        void navigate(`/search/${encodeURIComponent(word)}${query}`)
      }),
    [dictionaryId, navigate, setSearchQuery]
  )
}
