import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Copy, Languages, LoaderCircle, MoreHorizontal, Quote } from 'lucide-react'

import appIcon from '@/assets/icon_32x32.png'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { SelectionToolbarPayload } from '../../../shared/selection-toolbar'

declare global {
  interface Window {
    dictolSelectionToolbar: {
      platform: string
      onUpdate: (callback: (payload: SelectionToolbarPayload) => void) => () => void
      lookupInMain: () => void
      explain: () => void
      translate: () => void
      copy: () => void
      captureExcerpt: () => Promise<void>
      openMenu: () => void
      activity: () => void
      rendered: (requestId: number) => void
    }
  }
}

const initialPayload: SelectionToolbarPayload = {
  requestId: 0,
  word: '',
  programName: '',
  canExclude: false,
  canCaptureExcerpt: false,
  canTranslate: false
}

export function SelectionToolbarApp(): React.JSX.Element {
  const [payload, setPayload] = useState(initialPayload)
  const [savingExcerpt, setSavingExcerpt] = useState(false)
  const savingExcerptRef = useRef(false)
  const lastActivityAt = useRef(Number.NEGATIVE_INFINITY)

  const notifyActivity = useCallback((): void => {
    const now = performance.now()
    if (now - lastActivityAt.current < 500) return
    lastActivityAt.current = now
    window.dictolSelectionToolbar.activity()
  }, [])

  const captureExcerpt = async (): Promise<void> => {
    if (savingExcerptRef.current || !payload.canCaptureExcerpt) return
    savingExcerptRef.current = true
    setSavingExcerpt(true)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await window.dictolSelectionToolbar.captureExcerpt()
    } finally {
      savingExcerptRef.current = false
      setSavingExcerpt(false)
    }
  }

  useEffect(() => {
    return window.dictolSelectionToolbar.onUpdate(setPayload)
  }, [])

  useEffect(() => {
    if (payload.requestId === 0) return

    // Let Chromium commit the updated toolbar before the Windows native window
    // changes from zero opacity to visible.
    let paintedFrame = 0
    const committedFrame = requestAnimationFrame(() => {
      paintedFrame = requestAnimationFrame(() => {
        window.dictolSelectionToolbar.rendered(payload.requestId)
      })
    })
    return () => {
      cancelAnimationFrame(committedFrame)
      cancelAnimationFrame(paintedFrame)
    }
  }, [payload.requestId])

  return (
    <div
      className="selection-toolbar-shell"
      data-platform={window.dictolSelectionToolbar.platform}
      onPointerDown={notifyActivity}
      onPointerMove={notifyActivity}
    >
      <div className="selection-menu">
        <Button
          aria-label="在 Dictol 中查询"
          className="selection-action selection-action-logo"
          disabled={savingExcerpt}
          onClick={() => window.dictolSelectionToolbar.lookupInMain()}
          size="icon"
          title={payload.word ? `在 Dictol 中查询“${payload.word}”` : '在 Dictol 中查询'}
          type="button"
          variant="ghost"
        >
          <img alt="" draggable={false} src={appIcon} />
        </Button>
        <Separator className="selection-action-separator" orientation="vertical" />
        <Button
          className="selection-action"
          disabled={savingExcerpt}
          onClick={() => window.dictolSelectionToolbar.copy()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Copy />
          复制
        </Button>
        <Button
          className="selection-action selection-action-primary"
          disabled={savingExcerpt || !payload.word || payload.word.length > 200}
          onClick={() => window.dictolSelectionToolbar.explain()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <BookOpen />
          查词
        </Button>
        <Button
          className="selection-action selection-action-primary"
          disabled={savingExcerpt || !payload.canTranslate}
          onClick={() => window.dictolSelectionToolbar.translate()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Languages />
          翻译
        </Button>
        <Button
          aria-label="摘抄选中文本"
          aria-busy={savingExcerpt}
          className="selection-action selection-action-primary"
          disabled={!payload.canCaptureExcerpt || savingExcerpt}
          onClick={() => void captureExcerpt()}
          size="sm"
          title={savingExcerpt ? '正在保存摘抄…' : '摘抄选中文本'}
          type="button"
          variant="ghost"
        >
          {savingExcerpt ? <LoaderCircle className="animate-spin" /> : <Quote />}
          {savingExcerpt ? '正在保存…' : '摘抄'}
        </Button>
        <Separator className="selection-action-separator" orientation="vertical" />
        <Button
          aria-label="更多划词操作"
          className="selection-action selection-action-more"
          disabled={savingExcerpt || !payload.canExclude}
          onClick={() => window.dictolSelectionToolbar.openMenu()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal />
        </Button>
      </div>
    </div>
  )
}
