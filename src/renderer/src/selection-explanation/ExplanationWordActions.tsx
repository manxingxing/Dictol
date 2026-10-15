import { useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { SelectionExplanationPayload } from '../../../shared/selection-explanation'

type Props = {
  payload: SelectionExplanationPayload
}

export function ExplanationWordActions({ payload }: Props): React.JSX.Element {
  const [starStatus, setStarStatus] = useState<{ key: string; starred: boolean } | undefined>()
  const [togglingStar, setTogglingStar] = useState(false)
  const wordKey = payload.word.trim()
  const starStatusReady = Boolean(wordKey) && starStatus?.key === wordKey
  const isStarred = starStatusReady && starStatus.starred
  const showStar =
    payload.mode === 'ai' ? Boolean(wordKey) : payload.state === 'content' || starStatusReady
  const canToggleStar =
    starStatusReady && !togglingStar && (payload.mode === 'ai' || payload.state === 'content')

  useEffect(() => {
    if (!wordKey || (payload.mode !== 'ai' && payload.state !== 'content') || starStatusReady) {
      return
    }
    let active = true
    void window.dictolSelectionExplanation
      .isStarred(wordKey)
      .then((starred) => {
        if (active) setStarStatus({ key: wordKey, starred })
      })
      .catch((error: unknown) => {
        console.error('Failed to query word star status', error)
      })
    return () => {
      active = false
    }
  }, [payload.mode, payload.state, starStatusReady, wordKey])

  const toggleStar = async (): Promise<void> => {
    if (!canToggleStar || !starStatus) return
    const nextStarred = !starStatus.starred
    setTogglingStar(true)
    try {
      await window.dictolSelectionExplanation.toggleStar(wordKey)
      setStarStatus({ key: wordKey, starred: nextStarred })
    } catch (error) {
      console.error('Failed to toggle word star status', error)
    } finally {
      setTogglingStar(false)
    }
  }

  return (
    <>
      {showStar && (
        <Button
          aria-label={isStarred ? '取消标星' : '加入默认生词本'}
          className="no-drag size-7 shrink-0 disabled:opacity-100"
          disabled={!canToggleStar}
          onClick={() => void toggleStar()}
          size="icon"
          title={isStarred ? '取消标星' : '加入默认生词本'}
          type="button"
          variant="ghost"
        >
          {togglingStar ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Star className={isStarred ? 'fill-amber-400 text-amber-400' : ''} />
          )}
        </Button>
      )}
      <Button
        aria-label="在主窗口中打开"
        className="no-drag size-7 shrink-0"
        onClick={() => window.dictolSelectionExplanation.openInMain()}
        size="icon"
        title="在主窗口中打开"
        type="button"
        variant="ghost"
      >
        <ExternalLink />
      </Button>
    </>
  )
}
