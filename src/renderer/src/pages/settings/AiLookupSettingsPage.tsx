import { useState } from 'react'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { AiModelSelect } from '@/components/settings/AiModelSelect'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  useAiLookupConfig,
  useSaveAiLookupConfig,
  useTestAiLookupConfig
} from '@/hooks/use-ai-lookup'
import {
  AI_PROVIDER_PRESETS,
  isAiProviderId,
  normalizeAiBaseUrl,
  parseAiExtraParams
} from '../../../../shared/ai-settings'
import type { AiLookupPublicConfig } from '../../../../shared/ai-ipc'

export function AiLookupSettingsPage(): React.JSX.Element {
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const aiConfig = useAiLookupConfig()
  const saveAiConfig = useSaveAiLookupConfig()
  const testAiConfig = useTestAiLookupConfig()

  return (
    <SettingsSection title="AI 增强" description="在词条解释区和划词工具栏中使用 AI 生成词语解释。">
      <SettingsList>
        <SettingsRow
          label="启用 AI 增强"
          description="开启后可在词条解释区打开聊天侧栏，也可从划词工具栏获取单次解释"
        >
          <div className="flex shrink-0 items-center gap-2">
            <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  disabled={!aiConfig.data || saveAiConfig.isPending}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  配置
                </Button>
              </DialogTrigger>
              {aiDialogOpen && aiConfig.data && (
                <AiConfigDialog config={aiConfig.data} onClose={() => setAiDialogOpen(false)} />
              )}
            </Dialog>
            <Button
              aria-label={testAiConfig.isPending ? '正在验证 AI 配置' : '验证 AI 配置'}
              className="min-w-12"
              disabled={!aiConfig.data || saveAiConfig.isPending || testAiConfig.isPending}
              onClick={() =>
                testAiConfig.mutate(undefined, {
                  onSuccess: () => toast.success('AI 配置验证成功。'),
                  onError: (error) => toast.error('AI 配置验证失败', { description: error.message })
                })
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              {testAiConfig.isPending ? <LoaderCircle className="animate-spin" /> : '验证'}
            </Button>
            <Switch
              aria-label="启用 AI 增强"
              checked={aiConfig.data?.enabled ?? false}
              disabled={!aiConfig.data || saveAiConfig.isPending}
              id="ai-lookup-enabled"
              onCheckedChange={(enabled) => {
                if (aiConfig.data) saveAiConfig.mutate({ ...aiConfig.data, enabled })
              }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
      {(aiConfig.error || saveAiConfig.error) && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {(aiConfig.error || saveAiConfig.error)?.message}
        </p>
      )}
    </SettingsSection>
  )
}

function AiConfigDialog({
  config,
  onClose
}: {
  config: AiLookupPublicConfig
  onClose: () => void
}): React.JSX.Element {
  const [form, setForm] = useState(() => ({ ...config, apiKey: '' }))
  const [error, setError] = useState<string | null>(null)
  const [extraOpen, setExtraOpen] = useState(false)
  const saveConfig = useSaveAiLookupConfig()
  const testConfig = useTestAiLookupConfig()
  const baseUrl = normalizeAiBaseUrl(form.baseUrl)
  const hasSavedKey = config.hasApiKey && baseUrl === normalizeAiBaseUrl(config.baseUrl)
  const busy = saveConfig.isPending || testConfig.isPending

  const validate = (): boolean => {
    setError(null)
    if (!baseUrl) {
      setError('请填写有效的 HTTP 或 HTTPS 服务地址。')
      return false
    }
    if (!form.model.trim()) {
      setError('请选择或输入模型名称。')
      return false
    }
    try {
      parseAiExtraParams(form.extraParams)
      return true
    } catch (cause) {
      setExtraOpen(true)
      setError(cause instanceof Error ? cause.message : '额外参数无效。')
      return false
    }
  }

  return (
    <DialogContent
      showCloseButton={!busy}
      className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl"
      onInteractOutside={(event) => {
        if (busy) event.preventDefault()
      }}
      onEscapeKeyDown={(event) => {
        if (busy) event.preventDefault()
      }}
    >
      <DialogHeader variant="section">
        <DialogTitle>配置 AI 查词</DialogTitle>
        <DialogDescription>连接兼容 OpenAI Chat Completions 的模型服务</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto px-6 py-4">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="space-y-1.5 text-sm">
            <label htmlFor="ai-provider" className="font-medium">
              服务商
            </label>
            <Select
              value={form.providerId}
              onValueChange={(providerId) => {
                if (!isAiProviderId(providerId)) return
                const preset = AI_PROVIDER_PRESETS.find((item) => item.id === providerId)
                setForm((current) => ({
                  ...current,
                  providerId,
                  baseUrl: preset?.baseUrl ?? current.baseUrl,
                  apiKey: '',
                  model: providerId === 'custom' ? current.model : ''
                }))
                setError(null)
              }}
            >
              <SelectTrigger id="ai-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_PROVIDER_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.providerId === 'custom' ? (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">服务地址（Base URL）</span>
              <Input
                type="url"
                placeholder="https://api.example.com/v1"
                value={form.baseUrl}
                onChange={(event) =>
                  setForm((current) => ({ ...current, baseUrl: event.target.value, apiKey: '' }))
                }
              />
            </label>
          ) : (
            <p className="break-all text-xs text-muted-foreground">服务地址：{form.baseUrl}</p>
          )}
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">API Key</span>
            <Input
              autoComplete="off"
              type="password"
              value={form.apiKey}
              placeholder={hasSavedKey ? '已配置，留空以保留' : 'API Key (本地服务可留空)'}
              onChange={(event) =>
                setForm((current) => ({ ...current, apiKey: event.target.value }))
              }
            />
            <span className="block text-xs leading-5 text-muted-foreground">
              API Key 使用系统安全存储加密。更换服务地址后需重新填写。
            </span>
          </label>
          <div className="space-y-1.5 text-sm">
            <label htmlFor="ai-model" className="font-medium">
              模型
            </label>
            <AiModelSelect
              baseUrl={baseUrl}
              apiKey={form.apiKey}
              hasSavedKey={hasSavedKey}
              value={form.model}
              onChange={(model) => setForm((current) => ({ ...current, model }))}
            />
          </div>
          <details
            open={extraOpen}
            onToggle={(event) => setExtraOpen(event.currentTarget.open)}
            className="rounded-lg border border-border px-3 py-2"
          >
            <summary className="cursor-pointer text-sm font-medium">额外请求参数（JSON）</summary>
            <label className="mt-3 block space-y-2">
              <span className="block text-xs leading-5 text-muted-foreground">
                在请求前按顶层字段合并，同名参数覆盖默认值；嵌套对象整体替换。留空使用默认参数。
              </span>
              <textarea
                aria-label="额外请求参数（JSON）"
                spellCheck={false}
                rows={6}
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                placeholder={'{\n  "temperature": 0.5,\n  "max_tokens": 2048\n}'}
                value={form.extraParams}
                onChange={(event) =>
                  setForm((current) => ({ ...current, extraParams: event.target.value }))
                }
              />
            </label>
          </details>
        </fieldset>
        {error && (
          <FieldError className="mt-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </FieldError>
        )}
      </div>
      <DialogFooter className="justify-end border-t border-border bg-muted/20 px-6 py-4 sm:items-center">
        <Button
          size="sm"
          variant="outline"
          className="sm:mr-auto"
          disabled={busy}
          onClick={() => {
            if (!validate()) return
            testConfig.mutate(form, {
              onSuccess: () => toast.success('AI 配置验证成功。'),
              onError: (cause) => setError(cause.message)
            })
          }}
        >
          {testConfig.isPending ? '验证中…' : '测试连接'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            if (!validate()) return
            saveConfig.mutate(form, {
              onSuccess: onClose,
              onError: (cause) => setError(cause.message)
            })
          }}
        >
          {saveConfig.isPending ? '保存中…' : '保存配置'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
