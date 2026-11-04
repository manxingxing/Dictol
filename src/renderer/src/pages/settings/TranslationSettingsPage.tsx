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
import { ShortcutSettingControl } from '@/components/settings/ShortcutSettingControl'
import {
  useSelectionTranslationShortcutStatus,
  useScreenshotTranslationStatus,
  useUpdateScreenshotShortcut,
  useUpdateSelectionTranslationShortcut
} from '@/hooks/use-translation-shortcuts'
import { formatShortcut } from '@/lib/keyboard-shortcut'
import {
  SCREENSHOT_TRANSLATION_SHORTCUT,
  TRANSLATE_SELECTION_SHORTCUT
} from '../../../../shared/shortcuts'
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGE_NAMES,
  type TranslationLanguage,
  type TranslationProviderKind,
  type TranslationPublicConfig,
  type TranslationPublicProvider,
  type TranslationSaveProviderRequest
} from '../../../../shared/translation'

type ConfigurableProviderKind = Exclude<TranslationProviderKind, 'system'>
type BusyOperation = { id: string; kind: 'change' | 'verify' }
const providerNames: Record<ConfigurableProviderKind, string> = {
  google: 'Google 翻译',
  microsoft: 'Microsoft 翻译',
  baidu: '百度翻译',
  deepl: 'DeepL 翻译',
  volcano: '火山翻译',
  'youdao-web': '有道在线翻译',
  'google-web': 'Google 在线翻译',
  'bing-web': 'Bing 在线翻译',
  'openai-compatible': 'OpenAI 兼容 LLM'
}
const webProviderKinds: TranslationProviderKind[] = ['youdao-web', 'google-web', 'bing-web']

export function TranslationSettingsPage(): React.JSX.Element {
  const [config, setConfig] = useState<TranslationPublicConfig | null>(null)
  const screenshotStatusQuery = useScreenshotTranslationStatus()
  const screenshotStatus = screenshotStatusQuery.data
  const selectionShortcutStatusQuery = useSelectionTranslationShortcutStatus()
  const selectionShortcutStatus = selectionShortcutStatusQuery.data
  const updateSelectionShortcutMutation = useUpdateSelectionTranslationShortcut()
  const updateScreenshotShortcutMutation = useUpdateScreenshotShortcut()
  const resetSelectionShortcutMutation = updateSelectionShortcutMutation.reset
  const resetScreenshotShortcutMutation = updateScreenshotShortcutMutation.reset
  const [draft, setDraft] = useState<TranslationSaveProviderRequest | null>(null)
  const [error, setError] = useState('')
  const [busyOperation, setBusyOperation] = useState<BusyOperation | null>(null)
  const [draggedProviderId, setDraggedProviderId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    position: 'before' | 'after'
  } | null>(null)
  const verifyingProviderId = busyOperation?.kind === 'verify' ? busyOperation.id : null
  const screenshotStatusMessage =
    updateScreenshotShortcutMutation.error?.message ??
    (updateScreenshotShortcutMutation.data?.ok === false
      ? (updateScreenshotShortcutMutation.data.error ?? '无法保存截图翻译设置。')
      : null) ??
    screenshotStatusQuery.error?.message ??
    (screenshotStatus?.supported && screenshotStatus.shortcut && !screenshotStatus.registered
      ? `截图翻译快捷键 ${formatShortcut(screenshotStatus.shortcut, window.dictol.platform)} 注册失败，可能已被系统或其他应用占用。请更换快捷键。`
      : null)
  const selectionShortcutMessage =
    updateSelectionShortcutMutation.error?.message ??
    (updateSelectionShortcutMutation.data?.ok === false
      ? (updateSelectionShortcutMutation.data.error ?? '无法保存选区翻译快捷键设置。')
      : null) ??
    selectionShortcutStatusQuery.error?.message

  useEffect(() => {
    if (screenshotStatusQuery.dataUpdatedAt) resetScreenshotShortcutMutation()
  }, [screenshotStatusQuery.dataUpdatedAt, resetScreenshotShortcutMutation])

  useEffect(() => {
    if (selectionShortcutStatusQuery.dataUpdatedAt) resetSelectionShortcutMutation()
  }, [selectionShortcutStatusQuery.dataUpdatedAt, resetSelectionShortcutMutation])

  useEffect(() => {
    void window.dictol.translation
      .getConfig()
      .then(setConfig)
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : '无法读取翻译服务设置。')
      })
  }, [])

  const updateSelectionShortcut = async (shortcut: string): Promise<void> => {
    await updateSelectionShortcutMutation.mutateAsync(shortcut)
  }

  const updateScreenshotShortcut = async (shortcut: string): Promise<void> => {
    await updateScreenshotShortcutMutation.mutateAsync(shortcut)
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
      <SettingsList className="mb-3">
        <SettingsRow label="默认目标语言">
          <select
            aria-label="默认目标语言"
            id="translation-target"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            disabled={!config || Boolean(busyOperation)}
            onChange={(event) =>
              void apply('target', () =>
                window.dictol.translation.setTargetLanguage(
                  event.target.value as TranslationLanguage
                )
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
        </SettingsRow>
        {selectionShortcutStatus?.supported && (
          <SettingsRow
            label="划词翻译"
            description={
              !selectionShortcutStatus.shortcut
                ? '未设置快捷键'
                : selectionShortcutStatus.registered
                  ? '在翻译弹窗里查看所选文本的译文'
                  : '快捷键未启用，请重新设置'
            }
          >
            <ShortcutSettingControl
              allowClear
              command={TRANSLATE_SELECTION_SHORTCUT}
              currentShortcut={selectionShortcutStatus.shortcut}
              onClear={() => updateSelectionShortcut('')}
              onUpdate={updateSelectionShortcut}
            />
          </SettingsRow>
        )}
        {selectionShortcutMessage && (
          <p
            className="border-b border-border bg-card px-4 py-2 text-xs text-destructive last:border-b-0"
            role="alert"
          >
            {selectionShortcutMessage}
          </p>
        )}
        {screenshotStatus?.supported && (
          <SettingsRow
            label="截图翻译"
            description={
              !screenshotStatus.shortcut
                ? '未设置快捷键'
                : screenshotStatus.registered
                  ? '识别截图中的文本，在翻译弹窗里查看译文'
                  : '按快捷键框选屏幕文字，识别后查看译文'
            }
          >
            <ShortcutSettingControl
              allowClear
              command={SCREENSHOT_TRANSLATION_SHORTCUT}
              currentShortcut={screenshotStatus.shortcut}
              onClear={() => updateScreenshotShortcut('')}
              onUpdate={updateScreenshotShortcut}
            />
          </SettingsRow>
        )}
        {screenshotStatusMessage && (
          <p
            className="border-b border-border bg-card px-4 py-2 text-xs text-destructive last:border-b-0"
            role="alert"
          >
            {screenshotStatusMessage}
          </p>
        )}
      </SettingsList>

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
              {draft.kind === 'baidu' && (
                <>
                  <p className="text-xs text-muted-foreground">
                    请先在百度翻译开放平台开通通用文本翻译 API。
                  </p>
                  <label className="block space-y-1 text-sm">
                    <span>APP ID</span>
                    <Input
                      onChange={(event) => updateOption('appId', event.target.value)}
                      placeholder="百度翻译开放平台的 APP ID"
                      value={draft.options.appId ?? ''}
                    />
                  </label>
                </>
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
              ) : draft.kind === 'baidu' ? (
                <label className="block space-y-1 text-sm">
                  <span>密钥</span>
                  <Input
                    autoComplete="off"
                    onChange={(event) => updateCredential('secretKey', event.target.value)}
                    placeholder="留空保留已保存的密钥"
                    type="password"
                    value={draft.credentials?.secretKey ?? ''}
                  />
                </label>
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
