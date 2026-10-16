import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  CheckCircle2,
  CircleAlert,
  ChevronsUpDown,
  Settings,
  ShieldAlert,
  Trash2
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatShortcut, shortcutFromKeyboardEvent } from '@/lib/keyboard-shortcut'
import { useDictionaryGroups } from '@/hooks/use-dictionary-groups'

type WordCaptureStatus = Awaited<ReturnType<typeof window.dictol.wordCapture.getStatus>>

export function WordCaptureSettingsCard(): React.JSX.Element {
  const [captureStatus, setCaptureStatus] = useState<WordCaptureStatus>(null)
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [savingShortcut, setSavingShortcut] = useState(false)
  const [recordingOcrShortcut, setRecordingOcrShortcut] = useState<'dictionary' | 'ai' | null>(null)
  const [savingOcr, setSavingOcr] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [screenCaptureSettingsError, setScreenCaptureSettingsError] = useState<string | null>(null)
  const [savingSelectionLookup, setSavingSelectionLookup] = useState(false)
  const [savingSelectionGroup, setSavingSelectionGroup] = useState(false)
  const [selectionGroupPickerOpen, setSelectionGroupPickerOpen] = useState(false)
  const [removingProgram, setRemovingProgram] = useState<string | null>(null)
  const [shortcutError, setShortcutError] = useState<string | null>(null)
  const [selectionLookupError, setSelectionLookupError] = useState<string | null>(null)
  const [selectionGroupError, setSelectionGroupError] = useState<string | null>(null)
  const [excludedProgramsError, setExcludedProgramsError] = useState<string | null>(null)
  const [openingInputMonitoringSettings, setOpeningInputMonitoringSettings] = useState(false)
  const [inputMonitoringSettingsError, setInputMonitoringSettingsError] = useState<string | null>(
    null
  )

  const refreshCaptureStatus = useCallback(() => {
    void window.dictol.wordCapture.getStatus().then(setCaptureStatus)
  }, [])
  const { data: dictionaryGroups = [] } = useDictionaryGroups()
  const selectedSelectionGroup = dictionaryGroups.find(
    (group) => group.id === captureStatus?.selectionDictionaryGroupId
  )

  useEffect(() => {
    refreshCaptureStatus()
    window.addEventListener('focus', refreshCaptureStatus)
    return () => window.removeEventListener('focus', refreshCaptureStatus)
  }, [refreshCaptureStatus])

  return (
    <SettingsSection
      title="取词"
      description="在其他软件中选择文字，使用快捷键或划词工具栏获取词条解释"
    >
      {!captureStatus ? (
        <SettingsList>
          <div className="px-4 py-5 text-sm text-muted-foreground">正在检查取词状态…</div>
        </SettingsList>
      ) : !captureStatus.supported ? (
        <SettingsList>
          <div className="flex items-center gap-2 bg-card px-4 py-5 text-sm text-muted-foreground">
            <Settings className="size-4" />
            {captureStatus.limitation ?? '当前平台暂不支持快捷键取词。'}
          </div>
        </SettingsList>
      ) : (
        <div className="space-y-3">
          {captureStatus.limitation && (
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs leading-5 text-muted-foreground">
              {captureStatus.limitation}
            </div>
          )}
          <SettingsList>
            <SettingsRow
              label="取词组"
              description="查词弹窗使用的词典组"
              control={
                <Popover open={selectionGroupPickerOpen} onOpenChange={setSelectionGroupPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      aria-expanded={selectionGroupPickerOpen}
                      aria-label="取词组"
                      className="w-56 max-w-[60vw] min-w-20 justify-between border border-input bg-background font-normal shadow-xs hover:bg-background"
                      disabled={savingSelectionGroup}
                      role="combobox"
                      variant="outline"
                    >
                      <span className="truncate">{selectedSelectionGroup?.name ?? '全部词典'}</span>
                      <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                  >
                    <Command>
                      <CommandInput placeholder="搜索词典组..." />
                      <CommandList className="max-h-[min(18rem,50vh)]">
                        <CommandEmpty>没有找到匹配的词典组。</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="全部词典"
                            onSelect={() => {
                              setSelectionGroupError(null)
                              setSavingSelectionGroup(true)
                              void window.dictol.wordCapture
                                .setSelectionDictionaryGroup(null)
                                .then((result) => {
                                  if (!result) {
                                    setSelectionGroupError('无法更新取词组。')
                                    return
                                  }
                                  setCaptureStatus(result.status)
                                  setSelectionGroupError(result.error ?? null)
                                  if (!result.error) setSelectionGroupPickerOpen(false)
                                })
                                .finally(() => setSavingSelectionGroup(false))
                            }}
                          >
                            <Check
                              className={
                                !captureStatus.selectionDictionaryGroupId
                                  ? 'size-4 opacity-100'
                                  : 'size-4 opacity-0'
                              }
                            />
                            全部词典
                          </CommandItem>
                          {dictionaryGroups.map((group) => (
                            <CommandItem
                              key={group.id}
                              value={group.name}
                              onSelect={() => {
                                setSelectionGroupError(null)
                                setSavingSelectionGroup(true)
                                void window.dictol.wordCapture
                                  .setSelectionDictionaryGroup(group.id)
                                  .then((result) => {
                                    if (!result) {
                                      setSelectionGroupError('无法更新取词组。')
                                      return
                                    }
                                    setCaptureStatus(result.status)
                                    setSelectionGroupError(result.error ?? null)
                                    if (!result.error) setSelectionGroupPickerOpen(false)
                                  })
                                  .finally(() => setSavingSelectionGroup(false))
                              }}
                            >
                              <Check
                                className={
                                  captureStatus.selectionDictionaryGroupId === group.id
                                    ? 'size-4 opacity-100'
                                    : 'size-4 opacity-0'
                                }
                              />
                              <span className="truncate">{group.name}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              }
              className="items-start"
            />
            <SettingsRow
              label="划词取词"
              description={
                recordingShortcut
                  ? '请直接按下新的组合键，按 Esc 取消'
                  : captureStatus.registered
                    ? '快捷键已启用'
                    : '快捷键被其他应用占用，请重新设置'
              }
              control={
                <div className="flex items-center gap-2">
                  <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
                    {recordingShortcut
                      ? '等待输入…'
                      : formatShortcut(captureStatus.shortcut, window.dictol.platform)}
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
                      void window.dictol.wordCapture
                        .setShortcut(shortcut)
                        .then((result) => {
                          if (!result) {
                            setShortcutError('无法更新快捷键设置。')
                            return
                          }
                          setCaptureStatus(result.status)
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
            {shortcutError && (
              <p
                className="border-b border-border bg-card px-4 py-3 text-xs text-destructive"
                role="alert"
              >
                {shortcutError}
              </p>
            )}
            {selectionGroupError && (
              <p
                className="border-b border-border bg-card px-4 py-3 text-xs text-destructive"
                role="alert"
              >
                {selectionGroupError}
              </p>
            )}
            <div className="border-b border-border bg-card px-4 py-3 last:border-b-0">
              <Field className="items-start gap-4" orientation="horizontal">
                <FieldContent>
                  <FieldLabel className="cursor-pointer" htmlFor="lookup-word-on-selection">
                    划词工具栏
                  </FieldLabel>
                  <FieldDescription
                    className="text-xs leading-5"
                    id="lookup-word-on-selection-description"
                  >
                    在其他软件中选中文字后弹出工具栏，使用查词等多项功能
                  </FieldDescription>
                </FieldContent>
                <Switch
                  aria-describedby={
                    selectionLookupError
                      ? 'lookup-word-on-selection-description lookup-word-on-selection-error'
                      : 'lookup-word-on-selection-description'
                  }
                  aria-invalid={Boolean(selectionLookupError)}
                  checked={captureStatus.lookupWordOnSelection}
                  disabled={savingSelectionLookup}
                  id="lookup-word-on-selection"
                  onCheckedChange={(checked) => {
                    setSelectionLookupError(null)
                    setSavingSelectionLookup(true)
                    void window.dictol.wordCapture
                      .setSelectionEnabled(checked)
                      .then((result) => {
                        if (!result) {
                          setSelectionLookupError('无法更新实时取词设置。')
                          return
                        }
                        setCaptureStatus(result.status)
                        setSelectionLookupError(result.error ?? null)
                      })
                      .finally(() => setSavingSelectionLookup(false))
                  }}
                />
              </Field>
            </div>
            {selectionLookupError && (
              <p
                className="border-b border-border bg-card px-4 py-3 text-xs text-destructive"
                id="lookup-word-on-selection-error"
                role="alert"
              >
                {selectionLookupError}
              </p>
            )}
            {captureStatus.lookupWordOnSelection && (
              <SettingsRow
                className="pl-8"
                label="排除程序"
                description="在这些程序中选择文字时，不会显示划词工具栏"
                control={
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => setExcludedProgramsError(null)}
                        type="button"
                        variant="ghost"
                      >
                        管理
                        {captureStatus.excludedPrograms.length > 0 &&
                          `（${captureStatus.excludedPrograms.length}）`}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>已排除的程序</DialogTitle>
                        <DialogDescription>
                          在这些程序中选择文字时，不会显示划词工具栏。
                        </DialogDescription>
                      </DialogHeader>

                      {captureStatus.excludedPrograms.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                          暂无被排除的程序
                        </div>
                      ) : (
                        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                          {captureStatus.excludedPrograms.map((programName) => (
                            <div
                              className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2"
                              key={programName}
                            >
                              <span className="min-w-0 truncate text-sm" title={programName}>
                                {programName}
                              </span>
                              <Button
                                aria-label={`从排除列表删除 ${programName}`}
                                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                                disabled={removingProgram !== null}
                                onClick={() => {
                                  setExcludedProgramsError(null)
                                  setRemovingProgram(programName)
                                  void window.dictol.wordCapture
                                    .removeExcludedProgram(programName)
                                    .then((result) => {
                                      if (!result) {
                                        setExcludedProgramsError('无法更新程序排除列表。')
                                        return
                                      }
                                      setCaptureStatus(result.status)
                                      setExcludedProgramsError(result.error ?? null)
                                    })
                                    .finally(() => setRemovingProgram(null))
                                }}
                                size="icon"
                                title="删除"
                                type="button"
                                variant="ghost"
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {excludedProgramsError && (
                        <FieldError className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5">
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                          <span>{excludedProgramsError}</span>
                        </FieldError>
                      )}

                      {window.dictol.platform === 'linux' && (
                        <p className="text-xs leading-5 text-muted-foreground">
                          Linux Wayland 无法提供来源程序名，因此程序排除列表仅在 X11 会话中生效。
                        </p>
                      )}
                    </DialogContent>
                  </Dialog>
                }
              />
            )}

            {captureStatus.ocrSupported && (
              <>
                <div className="border-b border-border bg-card px-4 py-3 last:border-b-0">
                  <Field className="items-start gap-4" orientation="horizontal">
                    <FieldContent>
                      <FieldLabel
                        className="inline-flex cursor-pointer items-center gap-2"
                        htmlFor="ocr-lookup-enabled"
                      >
                        悬停取词
                        <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                          Beta
                        </span>
                      </FieldLabel>
                      <FieldDescription className="text-xs leading-5">
                        在屏幕文字上按快捷键，识别鼠标下的词语
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      checked={captureStatus.ocrEnabled}
                      disabled={savingOcr}
                      id="ocr-lookup-enabled"
                      onCheckedChange={(enabled) => {
                        setOcrError(null)
                        setSavingOcr(true)
                        void window.dictol.wordCapture
                          .setOcrEnabled(enabled)
                          .then((result) => {
                            if (!result) {
                              setOcrError('无法更新悬停取词设置。')
                              return
                            }
                            setCaptureStatus(result.status)
                            setOcrError(result.error ?? null)
                          })
                          .finally(() => setSavingOcr(false))
                      }}
                    />
                  </Field>
                </div>
                {captureStatus.ocrEnabled &&
                  (['dictionary', 'ai'] as const).map((mode) => {
                    const isDictionary = mode === 'dictionary'
                    const shortcut = isDictionary
                      ? captureStatus.ocrDictionaryShortcut
                      : captureStatus.ocrAiShortcut
                    const registered = isDictionary
                      ? captureStatus.ocrDictionaryRegistered
                      : captureStatus.ocrAiRegistered
                    return (
                      <SettingsRow
                        className="pl-8"
                        key={mode}
                        label={isDictionary ? '悬停查词快捷键' : '悬停 AI 解释快捷键'}
                        description={
                          recordingOcrShortcut === mode
                            ? '请直接按下新的组合键，按 Esc 取消'
                            : registered
                              ? '快捷键已启用'
                              : '快捷键被占用，请重新设置'
                        }
                        control={
                          <div className="flex items-center gap-2">
                            <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
                              {recordingOcrShortcut === mode
                                ? '等待输入…'
                                : formatShortcut(shortcut, window.dictol.platform)}
                            </kbd>
                            <Button
                              disabled={savingOcr}
                              onClick={() => {
                                setOcrError(null)
                                setRecordingOcrShortcut(mode)
                              }}
                              onKeyDown={(event) => {
                                if (recordingOcrShortcut !== mode) return
                                event.preventDefault()
                                event.stopPropagation()
                                if (event.key === 'Escape') {
                                  setRecordingOcrShortcut(null)
                                  return
                                }
                                const nextShortcut = shortcutFromKeyboardEvent(event)
                                if (!nextShortcut) return
                                setRecordingOcrShortcut(null)
                                setSavingOcr(true)
                                void window.dictol.wordCapture
                                  .setOcrShortcut(mode, nextShortcut)
                                  .then((result) => {
                                    if (!result) {
                                      setOcrError('无法更新悬停取词快捷键。')
                                      return
                                    }
                                    setCaptureStatus(result.status)
                                    setOcrError(result.error ?? null)
                                  })
                                  .finally(() => setSavingOcr(false))
                              }}
                              size="sm"
                              variant="outline"
                            >
                              {recordingOcrShortcut === mode ? '按下组合键' : '修改'}
                            </Button>
                          </div>
                        }
                      />
                    )
                  })}
                {ocrError && (
                  <p
                    className="border-b border-border bg-card px-4 py-3 text-xs text-destructive"
                    role="alert"
                  >
                    {ocrError}
                  </p>
                )}
              </>
            )}
          </SettingsList>

          {window.dictol.platform === 'darwin' && (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border bg-muted/30 px-4 py-3">
                <p className="text-sm font-medium">macOS 权限</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  需要以下权限读取选区、鼠标下文字，并响应跨应用取词
                </p>
              </div>

              <div className="flex items-start justify-between gap-6 px-4 py-4">
                <div className="flex min-w-0 gap-3">
                  {captureStatus.trusted ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
                  ) : (
                    <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-medium">辅助功能</p>
                      <span className="text-xs text-muted-foreground">
                        {captureStatus.trusted ? '已开启' : '尚未开启'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      用于读取其他应用中的选中文本，以及鼠标下的文字和位置。
                    </p>
                    {!captureStatus.trusted && (
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        点击“开启辅助功能”，然后在系统设置中允许 Dictol。
                      </p>
                    )}
                  </div>
                </div>
                {!captureStatus.trusted && (
                  <Button
                    className="shrink-0"
                    onClick={() => {
                      void window.dictol.wordCapture.requestAccess().then(setCaptureStatus)
                    }}
                    size="sm"
                    variant="outline"
                  >
                    开启辅助功能
                  </Button>
                )}
              </div>

              <div className="flex items-start justify-between gap-6 border-t border-border px-4 py-4">
                <div className="flex min-w-0 gap-3">
                  <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">输入监控</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      用于感知划词结束和弹窗外点击，改善划词工具栏与解释弹窗体验。
                      <span className="mt-1 block">Dictol 不保存或上传键盘输入。</span>
                    </p>
                    <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs leading-5 text-muted-foreground">
                      <li>打开“输入监控”设置。</li>
                      <li>在应用列表中开启 Dictol。</li>
                      <li>退出并重新打开 Dictol。</li>
                    </ol>
                    {inputMonitoringSettingsError && (
                      <FieldError className="mt-2 text-xs leading-5">
                        {inputMonitoringSettingsError}
                      </FieldError>
                    )}
                  </div>
                </div>
                <Button
                  className="shrink-0"
                  disabled={openingInputMonitoringSettings}
                  onClick={() => {
                    setInputMonitoringSettingsError(null)
                    setOpeningInputMonitoringSettings(true)
                    void window.dictol.wordCapture
                      .openInputMonitoringSettings()
                      .then((result) => {
                        if (!result?.ok) {
                          setInputMonitoringSettingsError(result?.error ?? '无法打开输入监控设置。')
                        }
                      })
                      .finally(() => setOpeningInputMonitoringSettings(false))
                  }}
                  size="sm"
                  variant="outline"
                >
                  {openingInputMonitoringSettings ? '正在打开…' : '打开输入监控设置'}
                </Button>
              </div>
              {captureStatus.ocrEnabled && window.dictol.platform === 'darwin' && (
                <div className="flex items-start justify-between gap-6 border-t border-border px-4 py-4">
                  <div className="flex min-w-0 gap-3">
                    {captureStatus.screenCapturePermission === 'granted' ? (
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
                    ) : (
                      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium">屏幕录制</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        辅助功能无法读取鼠标下的文字时，会截取屏幕图像并在本机 OCR 识别。
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {captureStatus.screenCapturePermission === 'granted'
                          ? '已开启'
                          : '开发版请允许启动它的终端或 IDE 录制屏幕；安装版请允许 Dictol。'}
                      </p>
                      {screenCaptureSettingsError && (
                        <p className="mt-2 text-xs text-destructive" role="alert">
                          {screenCaptureSettingsError}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    className="shrink-0"
                    onClick={() => {
                      setScreenCaptureSettingsError(null)
                      void window.dictol.wordCapture.openScreenCaptureSettings().then((result) => {
                        if (!result?.ok) {
                          setScreenCaptureSettingsError(result?.error ?? '无法打开屏幕录制设置。')
                        }
                      })
                    }}
                    size="sm"
                    variant="outline"
                  >
                    打开屏幕录制设置
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
