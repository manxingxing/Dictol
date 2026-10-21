import { useEffect, useState } from 'react'
import { GripVertical, LoaderCircle, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { formatShortcut, shortcutFromKeyboardEvent } from '@/lib/keyboard-shortcut'
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGE_NAMES,
  type TranslationLanguage,
  type TranslationProviderKind,
  type TranslationPublicConfig,
  type TranslationPublicProvider,
  type TranslationSaveProviderRequest
} from '../../../shared/translation'

type ConfigurableProviderKind = Exclude<TranslationProviderKind, 'system'>
type BusyOperation = { id: string; kind: 'change' | 'verify' }
type ScreenshotStatus = Awaited<ReturnType<typeof window.dictol.translation.getScreenshotStatus>>

const providerNames: Record<ConfigurableProviderKind, string> = {
  google: 'Google 翻译',
  microsoft: 'Microsoft 翻译',
  deepl: 'DeepL 翻译',
  volcano: '火山翻译',
  'youdao-web': '有道在线翻译',
  'google-web': 'Google 在线翻译',
  'bing-web': 'Bing 在线翻译',
  'openai-compatible': 'OpenAI 兼容 LLM'
}
const webProviderKinds: TranslationProviderKind[] = ['youdao-web', 'google-web', 'bing-web']

export function TranslationSettingsCard(): React.JSX.Element {
  const [config, setConfig] = useState<TranslationPublicConfig | null>(null)
  const [screenshotStatus, setScreenshotStatus] = useState<ScreenshotStatus>(null)
  const [screenshotError, setScreenshotError] = useState<string | null>(null)
  const [screenshotBusy, setScreenshotBusy] = useState(false)
  const [recordingScreenshotShortcut, setRecordingScreenshotShortcut] = useState(false)
  const [draft, setDraft] = useState<TranslationSaveProviderRequest | null>(null)
  const [error, setError] = useState('')
  const [busyOperation, setBusyOperation] = useState<BusyOperation | null>(null)
  const [draggedProviderId, setDraggedProviderId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    position: 'before' | 'after'
  } | null>(null)
  const verifyingProviderId = busyOperation?.kind === 'verify' ? busyOperation.id : null

  useEffect(() => {
    void window.dictol.translation
      .getConfig()
      .then(setConfig)
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : '无法读取翻译服务设置。')
      })
  }, [])

  useEffect(() => {
    void window.dictol.translation
      .getScreenshotStatus()
      .then(setScreenshotStatus)
      .catch((cause) => {
        setScreenshotError(cause instanceof Error ? cause.message : '无法读取截图翻译设置。')
      })
  }, [])

  const updateScreenshotSetting = async (
    action: () => ReturnType<typeof window.dictol.translation.setScreenshotEnabled>
  ): Promise<void> => {
    setScreenshotBusy(true)
    setScreenshotError(null)
    try {
      const result = await action()
      if (result) setScreenshotStatus(result.status)
      if (!result?.ok) setScreenshotError(result?.error ?? '无法保存截图翻译设置。')
    } catch (cause) {
      setScreenshotError(cause instanceof Error ? cause.message : '无法保存截图翻译设置。')
    } finally {
      setScreenshotBusy(false)
    }
  }

  const apply = async (
    id: string,
    action: () => Promise<TranslationPublicConfig | null>
  ): Promise<boolean> => {
    setBusyOperation({ id, kind: 'change' })
    setError('')
    try {
      const next = await action()
      if (next) setConfig(next)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败。')
      return false
    } finally {
      setBusyOperation(null)
    }
  }

  const beginAdd = (kind: ConfigurableProviderKind): void => {
    const provider: TranslationSaveProviderRequest = {
      id: crypto.randomUUID(),
      kind,
      name: providerNames[kind],
      enabled: true,
      options:
        kind === 'deepl'
          ? { plan: 'free' }
          : kind === 'openai-compatible'
            ? { baseUrl: 'https://api.openai.com/v1', model: '' }
            : {},
      credentials: {}
    }
    if (webProviderKinds.includes(kind)) {
      void apply(provider.id, () => window.dictol.translation.saveProvider(provider))
      return
    }
    setDraft(provider)
    setError('')
  }

  const beginEdit = (provider: TranslationPublicProvider): void => {
    setDraft({ ...provider, options: { ...provider.options }, credentials: {} })
    setError('')
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    const saved = await apply(draft.id, () => window.dictol.translation.saveProvider(draft))
    if (saved) setDraft(null)
  }

  const updateOption = (key: string, value: string): void => {
    setDraft((current) =>
      current ? { ...current, options: { ...current.options, [key]: value } } : current
    )
  }

  const updateCredential = (key: string, value: string): void => {
    setDraft((current) =>
      current ? { ...current, credentials: { ...current.credentials, [key]: value } } : current
    )
  }

  const finishDragging = (): void => {
    setDraggedProviderId(null)
    setDropTarget(null)
  }

  return (
    <SettingsSection title="翻译" description="调用翻译服务将所选文本翻译为目标语言">
      <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
        <label className="text-sm font-medium" htmlFor="translation-target">
          默认目标语言
        </label>
        <select
          id="translation-target"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          disabled={!config || Boolean(busyOperation)}
          onChange={(event) =>
            void apply('target', () =>
              window.dictol.translation.setTargetLanguage(event.target.value as TranslationLanguage)
            )
          }
          value={config?.targetLanguage ?? 'zh'}
        >
          {TRANSLATION_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {TRANSLATION_LANGUAGE_NAMES[language]}
            </option>
          ))}
        </select>
      </div>
      {screenshotStatus?.supported && (
        <SettingsList className="mb-3">
          <SettingsRow
            label="截图翻译"
            description="按快捷键框选屏幕文字，识别后在翻译弹窗中查看译文"
            control={
              <Switch
                aria-label="截图翻译"
                checked={screenshotStatus.enabled}
                disabled={screenshotBusy}
                onCheckedChange={(enabled) =>
                  void updateScreenshotSetting(() =>
                    window.dictol.translation.setScreenshotEnabled(enabled)
                  )
                }
              />
            }
          />
          {screenshotStatus.enabled && (
            <SettingsRow
              className="pl-8"
              label="截图翻译快捷键"
              description={
                recordingScreenshotShortcut
                  ? '请按下新的组合键，按 Esc 取消'
                  : screenshotStatus.registered
                    ? '快捷键已启用'
                    : '快捷键被占用，请重新设置'
              }
              control={
                <div className="flex items-center gap-2">
                  <kbd className="min-w-24 rounded-md border border-border bg-muted px-3 py-1.5 text-center text-sm font-medium">
                    {recordingScreenshotShortcut
                      ? '等待输入…'
                      : formatShortcut(screenshotStatus.shortcut, window.dictol.platform)}
                  </kbd>
                  <Button
                    disabled={screenshotBusy}
                    onClick={() => {
                      setScreenshotError(null)
                      setRecordingScreenshotShortcut(true)
                    }}
                    onKeyDown={(event) => {
                      if (!recordingScreenshotShortcut) return
                      event.preventDefault()
                      event.stopPropagation()
                      if (event.key === 'Escape') {
                        setRecordingScreenshotShortcut(false)
                        return
                      }
                      const shortcut = shortcutFromKeyboardEvent(event)
                      if (!shortcut) return
                      setRecordingScreenshotShortcut(false)
                      void updateScreenshotSetting(() =>
                        window.dictol.translation.setScreenshotShortcut(shortcut)
                      )
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {recordingScreenshotShortcut ? '按下组合键' : '修改'}
                  </Button>
                </div>
              }
            />
          )}
          {screenshotError && (
            <p className="px-4 py-2 text-xs text-destructive">{screenshotError}</p>
          )}
        </SettingsList>
      )}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {config?.providers.map((provider) => (
          <div
            className={`flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 transition-[background-color,opacity] hover:bg-muted/40 ${draggedProviderId === provider.id ? 'opacity-45' : ''} ${
              dropTarget?.id === provider.id
                ? dropTarget.position === 'before'
                  ? 'border-t-2 border-t-primary'
                  : 'border-b-2 border-b-primary'
                : ''
            }`}
            key={provider.id}
            onDragOver={(event) => {
              if (!draggedProviderId || draggedProviderId === provider.id) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              const bounds = event.currentTarget.getBoundingClientRect()
              setDropTarget({
                id: provider.id,
                position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
              })
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (!draggedProviderId || !config) return
              const bounds = event.currentTarget.getBoundingClientRect()
              const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
              const currentOrder = config.providers.map((item) => item.id)
              const nextOrder = currentOrder.filter((id) => id !== draggedProviderId)
              let targetIndex = nextOrder.indexOf(provider.id)
              if (targetIndex < 0) return
              if (position === 'after') targetIndex += 1
              nextOrder.splice(targetIndex, 0, draggedProviderId)
              finishDragging()
              if (nextOrder.every((id, index) => id === currentOrder[index])) return
              void apply('order', () => window.dictol.translation.reorderProviders(nextOrder))
            }}
          >
            <button
              aria-label={`拖动排序 ${provider.name}`}
              className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
              disabled={Boolean(busyOperation)}
              draggable={!busyOperation}
              onDragEnd={finishDragging}
              onDragStart={(event) => {
                setDraggedProviderId(provider.id)
                setDropTarget(null)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', provider.id)
              }}
              type="button"
            >
              <GripVertical className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{provider.name}</p>
              <p className="text-xs text-muted-foreground">
                {!provider.enabled
                  ? '已关闭'
                  : provider.available
                    ? '可用'
                    : provider.kind === 'system'
                      ? '系统翻译不可用'
                      : '配置未完成'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {provider.kind !== 'system' && !webProviderKinds.includes(provider.kind) && (
                <Button
                  disabled={Boolean(busyOperation)}
                  onClick={() => beginEdit(provider)}
                  size="sm"
                  variant="outline"
                >
                  配置
                </Button>
              )}
              <Button
                aria-label={
                  verifyingProviderId === provider.id ? `正在验证 ${provider.name}` : undefined
                }
                className={
                  verifyingProviderId === provider.id ? 'min-w-12 disabled:opacity-100' : 'min-w-12'
                }
                disabled={Boolean(busyOperation) || !provider.available}
                onClick={() => {
                  setBusyOperation({ id: provider.id, kind: 'verify' })
                  setError('')
                  void window.dictol.translation
                    .testProvider(provider.id)
                    .then(() => toast.success(`${provider.name} 验证成功。`))
                    .catch((cause) => {
                      toast.error(`${provider.name} 验证失败`, {
                        description: cause instanceof Error ? cause.message : '连接失败。'
                      })
                    })
                    .finally(() => setBusyOperation(null))
                }}
                size="sm"
                variant="ghost"
              >
                {verifyingProviderId === provider.id ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  '验证'
                )}
              </Button>
              {provider.kind !== 'system' && (
                <Button
                  disabled={Boolean(busyOperation)}
                  onClick={() =>
                    void apply(provider.id, () =>
                      window.dictol.translation.removeProvider(provider.id)
                    )
                  }
                  size="sm"
                  variant="ghost"
                >
                  删除
                </Button>
              )}
              <Switch
                aria-label={`启用 ${provider.name}`}
                checked={provider.enabled}
                disabled={Boolean(busyOperation)}
                onCheckedChange={(enabled) =>
                  void apply(provider.id, () =>
                    window.dictol.translation.saveProvider({ ...provider, enabled })
                  )
                }
              />
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={!config || Boolean(busyOperation)} size="sm" variant="outline">
                <Plus />
                添加服务
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {Object.entries(providerNames)
                .filter(
                  ([kind]) =>
                    !webProviderKinds.includes(kind as TranslationProviderKind) ||
                    !config?.providers.some((provider) => provider.kind === kind)
                )
                .map(([kind, name]) => (
                  <DropdownMenuItem
                    key={kind}
                    onSelect={() => beginAdd(kind as ConfigurableProviderKind)}
                  >
                    {name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error && !draft && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null)
            setError('')
          }
        }}
        open={Boolean(draft)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>配置翻译服务</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="max-h-[60dvh] space-y-4 overflow-y-auto py-2">
              <label className="block space-y-1 text-sm">
                <span>名称</span>
                <Input
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  value={draft.name}
                />
              </label>
              {draft.kind === 'microsoft' && (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>Region（区域资源必填）</span>
                    <Input
                      onChange={(event) => updateOption('region', event.target.value)}
                      placeholder="例如 eastasia"
                      value={draft.options.region ?? ''}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>服务地址（可选）</span>
                    <Input
                      onChange={(event) => updateOption('endpoint', event.target.value)}
                      placeholder="https://api.cognitive.microsofttranslator.com"
                      value={draft.options.endpoint ?? ''}
                    />
                  </label>
                </>
              )}
              {draft.kind === 'deepl' && (
                <label className="block space-y-1 text-sm">
                  <span>API 套餐</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3"
                    onChange={(event) => updateOption('plan', event.target.value)}
                    value={draft.options.plan ?? 'free'}
                  >
                    <option value="free">API Free</option>
                    <option value="pro">API Pro</option>
                  </select>
                </label>
              )}
              {draft.kind === 'openai-compatible' && (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>服务地址</span>
                    <Input
                      onChange={(event) => updateOption('baseUrl', event.target.value)}
                      placeholder="https://api.openai.com/v1"
                      value={draft.options.baseUrl ?? ''}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>模型</span>
                    <Input
                      onChange={(event) => updateOption('model', event.target.value)}
                      value={draft.options.model ?? ''}
                    />
                  </label>
                </>
              )}
              {draft.kind === 'volcano' ? (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>Access Key ID</span>
                    <Input
                      autoComplete="off"
                      onChange={(event) => updateCredential('accessKeyId', event.target.value)}
                      placeholder="留空保留已保存的密钥"
                      type="password"
                      value={draft.credentials?.accessKeyId ?? ''}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Secret Access Key</span>
                    <Input
                      autoComplete="off"
                      onChange={(event) => updateCredential('secretAccessKey', event.target.value)}
                      placeholder="留空保留已保存的密钥"
                      type="password"
                      value={draft.credentials?.secretAccessKey ?? ''}
                    />
                  </label>
                </>
              ) : (
                <label className="block space-y-1 text-sm">
                  <span>
                    API Key{draft.kind === 'openai-compatible' ? '（本地模型可留空）' : ''}
                  </span>
                  <Input
                    autoComplete="off"
                    onChange={(event) => updateCredential('apiKey', event.target.value)}
                    placeholder="留空保留已保存的密钥"
                    type="password"
                    value={draft.credentials?.apiKey ?? ''}
                  />
                </label>
              )}
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setDraft(null)} variant="outline">
              取消
            </Button>
            <Button disabled={Boolean(busyOperation)} onClick={() => void saveDraft()}>
              {busyOperation ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
