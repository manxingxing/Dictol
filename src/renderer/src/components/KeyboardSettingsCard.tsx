import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { formatShortcut, shortcutFromKeyboardEvent } from '@/lib/keyboard-shortcut'

type KeyboardShortcutStatus = Awaited<ReturnType<typeof window.dictol.keyboard.getStatus>>

export function KeyboardSettingsCard(): React.JSX.Element {
  const [status, setStatus] = useState<KeyboardShortcutStatus>(null)
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [savingShortcut, setSavingShortcut] = useState(false)
  const [shortcutError, setShortcutError] = useState<string | null>(null)

  const refreshStatus = useCallback(() => {
    void window.dictol.keyboard.getStatus().then(setStatus)
  }, [])

  useEffect(() => {
    refreshStatus()
    window.addEventListener('focus', refreshStatus)
    return () => window.removeEventListener('focus', refreshStatus)
  }, [refreshStatus])

  return (
    <SettingsSection title="键盘">
      <SettingsList>
        {!status ? (
          <div className="px-4 py-5 text-sm text-muted-foreground">正在读取快捷键设置…</div>
        ) : (
          <>
            <SettingsRow
              label="唤起 Dictol"
              description={
                recordingShortcut
                  ? '请直接按下新的组合键，按 Esc 取消'
                  : status.registered
                    ? '快捷键已启用'
                    : '快捷键被其他应用占用，请重新设置'
              }
              control={
                <div className="flex items-center gap-2">
                  <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
                    {recordingShortcut
                      ? '等待输入…'
                      : formatShortcut(status.shortcut, window.dictol.platform)}
                  </kbd>
                  <Button
                    disabled={savingShortcut}
                    onClick={() => {
                      setShortcutError(null)
                      setRecordingShortcut(true)
                    }}
                    onKeyDown={(event) => {
                      if (!recordingShortcut) return
                      event.preventDefault()
                      event.stopPropagation()
                      if (event.key === 'Escape') {
                        setRecordingShortcut(false)
                        setShortcutError(null)
                        return
                      }

                      const shortcut = shortcutFromKeyboardEvent(event)
                      if (!shortcut) return
                      setRecordingShortcut(false)
                      setSavingShortcut(true)
                      void window.dictol.keyboard
                        .setMainWindowShortcut(shortcut)
                        .then((result) => {
                          if (!result) {
                            setShortcutError('无法更新快捷键设置。')
                            return
                          }
                          setStatus(result.status)
                          setShortcutError(result.error ?? null)
                        })
                        .finally(() => setSavingShortcut(false))
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {recordingShortcut ? '按下组合键' : '修改'}
                  </Button>
                </div>
              }
            />
            <SettingsRow
              label="搜索词条"
              description="聚焦查词搜索框"
              control={
                <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
                  {formatShortcut('CommandOrControl+K', window.dictol.platform)}
                </kbd>
              }
            />
            <SettingsRow
              label="查找当前词条内容"
              description="在当前词条内容中查找文字"
              control={
                <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
                  {formatShortcut('CommandOrControl+F', window.dictol.platform)}
                </kbd>
              }
            />
          </>
        )}
      </SettingsList>
      {shortcutError && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {shortcutError}
        </p>
      )}
    </SettingsSection>
  )
}
