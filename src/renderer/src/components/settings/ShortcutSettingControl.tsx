import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatShortcut, shortcutFromKeyboardEvent } from '@/lib/keyboard-shortcut'
import { cn } from '@/lib/utils'

type ShortcutSettingControlProps = {
  command: string
  currentShortcut: string
  onUpdate: (shortcut: string) => Promise<void>
  allowClear?: boolean
  onClear?: () => Promise<void>
}

export function ShortcutSettingControl(props: ShortcutSettingControlProps): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [clearHovered, setClearHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const captureVersionRef = useRef(0)
  const captureActiveRef = useRef(false)
  const captureToken = useId()
  const canClear = Boolean(props.allowClear && props.currentShortcut && props.onClear)

  const beginRecording = async (): Promise<void> => {
    const version = ++captureVersionRef.current
    setStarting(true)
    try {
      const acquired = await window.dictol.keyboard.beginShortcutCapture(
        captureToken,
        props.command
      )
      if (!acquired) return
      if (captureVersionRef.current !== version) {
        await window.dictol.keyboard.endShortcutCapture(captureToken)
        return
      }
      captureActiveRef.current = true
      setRecording(true)
    } catch (error) {
      console.error('Failed to begin shortcut recording', error)
    } finally {
      setStarting(false)
    }
  }

  const stopRecording = useCallback(async (): Promise<void> => {
    captureVersionRef.current += 1
    setRecording(false)
    setClearHovered(false)
    if (!captureActiveRef.current) return
    captureActiveRef.current = false
    await window.dictol.keyboard.endShortcutCapture(captureToken)
  }, [captureToken])

  useEffect(() => {
    return () => {
      captureVersionRef.current += 1
      if (captureActiveRef.current) {
        captureActiveRef.current = false
        void window.dictol.keyboard.endShortcutCapture(captureToken)
      }
    }
  }, [captureToken])

  useEffect(() => {
    if (recording) inputRef.current?.focus()
  }, [recording])

  useEffect(() => {
    if (!recording) return
    const onWindowBlur = (): void => {
      void stopRecording()
    }
    window.addEventListener('blur', onWindowBlur)
    return () => window.removeEventListener('blur', onWindowBlur)
  }, [recording, stopRecording])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setSaving(true)
    try {
      await action()
    } catch (error) {
      console.error('Failed to update shortcut', error)
    } finally {
      setSaving(false)
    }
  }

  const clearShortcut = (): void => {
    const onClear = props.onClear
    if (!canClear || !onClear) return
    void run(async () => {
      await stopRecording()
      await onClear()
    })
  }

  const handleShortcutKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      void stopRecording()
      return
    }
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      canClear
    ) {
      clearShortcut()
      return
    }
    const shortcut = shortcutFromKeyboardEvent(event)
    if (!shortcut) return
    void run(async () => {
      await stopRecording()
      await props.onUpdate(shortcut)
    })
  }

  return (
    <div
      className="flex items-center gap-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) void stopRecording()
      }}
    >
      {recording ? (
        <div className="relative">
          <input
            aria-label="输入快捷键，按 Esc 取消"
            className={cn(
              'rounded-md border border-border bg-muted py-1.5 text-xs font-medium outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
              canClear ? 'w-32 pl-3 pr-8 text-left' : 'w-24 px-3 text-center'
            )}
            onKeyDown={handleShortcutKeyDown}
            placeholder={clearHovered ? '清除快捷键' : '等待输入...'}
            readOnly
            ref={inputRef}
            type="text"
            value=""
          />
          {canClear && (
            <Button
              aria-label="清除快捷键"
              className="absolute right-1 top-1/2 size-5 -translate-y-1/2 rounded-full bg-foreground/10 p-0 hover:bg-foreground/20"
              disabled={saving}
              onBlur={() => setClearHovered(false)}
              onClick={clearShortcut}
              onFocus={() => setClearHovered(true)}
              onPointerDown={(event) => event.preventDefault()}
              onPointerEnter={() => setClearHovered(true)}
              onPointerLeave={() => setClearHovered(false)}
              size="xs"
              variant="ghost"
            >
              <X />
            </Button>
          )}
        </div>
      ) : (
        <kbd
          className={cn(
            'rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium',
            canClear ? 'w-32' : 'w-24'
          )}
        >
          {props.currentShortcut
            ? formatShortcut(props.currentShortcut, window.dictol.platform)
            : '未设置'}
        </kbd>
      )}
      <Button
        aria-label={recording ? '取消设置快捷键' : '修改快捷键'}
        disabled={saving || starting}
        onClick={() => {
          if (recording) void stopRecording()
          else void beginRecording()
        }}
        onPointerDown={(event) => {
          if (recording) event.preventDefault()
        }}
        size="sm"
        variant="outline"
      >
        {recording ? '取消' : '修改'}
      </Button>
    </div>
  )
}
