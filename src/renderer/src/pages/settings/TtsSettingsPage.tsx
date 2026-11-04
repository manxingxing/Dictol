import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { TtsPlaybackButton } from '@/components/TtsPlaybackButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  useSaveTtsConfig,
  useSaveTtsSettings,
  useSaveTtsVoice,
  useSystemTtsVoices,
  useTtsConfig,
  useTtsCredentialsStatus
} from '@/hooks/use-tts-config'
import type { TtsConfig, TtsEngineId } from '../../../../shared/tts'

const labels: Record<TtsEngineId, string> = {
  system: '系统 TTS',
  'openai-compatible': 'OpenAI 兼容',
  elevenlabs: 'ElevenLabs',
  'azure-speech': 'Azure Speech',
  'fish-audio': 'Fish Audio'
}

export function TtsSettingsPage(): React.JSX.Element {
  const configQuery = useTtsConfig()
  const credentialsQuery = useTtsCredentialsStatus()
  const voiceQuery = useSystemTtsVoices()
  const saveConfig = useSaveTtsConfig()
  const saveSettings = useSaveTtsSettings()
  const saveVoice = useSaveTtsVoice()
  const config = configQuery.data
  const voices = voiceQuery.data ?? []
  const [voicePickerOpen, setVoicePickerOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<TtsConfig | null>(null)
  const [apiKey, setApiKey] = useState('')

  const selectedVoice = voices.find((voice) => voice.uri === config?.systemVoiceUri)
  const selectedVoiceLabel = selectedVoice
    ? `${selectedVoice.name} · ${selectedVoice.lang}`
    : config?.systemVoiceUri
      ? '已保存的音色不可用'
      : '系统默认'
  const provider = config?.engine === 'system' ? null : config?.engine
  const hasKey = provider ? credentialsQuery.data?.[provider] : false
  let configured = false
  switch (provider) {
    case 'openai-compatible':
      configured = Boolean(config?.openai.baseUrl && config.openai.model && config.openai.voice)
      break
    case 'elevenlabs':
      configured = Boolean(config?.elevenlabs.model && config.elevenlabs.voiceId && hasKey)
      break
    case 'azure-speech':
      configured = Boolean(config?.azure.region && config.azure.voice && hasKey)
      break
    case 'fish-audio':
      configured = Boolean(config?.fish.model.trim() && hasKey)
      break
  }
  const error =
    configQuery.error?.message ??
    saveConfig.error?.message ??
    saveVoice.error?.message ??
    credentialsQuery.error?.message ??
    voiceQuery.error?.message

  const openDialog = (): void => {
    if (!config) return
    setDraft({
      ...config,
      openai: { ...config.openai },
      elevenlabs: { ...config.elevenlabs },
      azure: { ...config.azure },
      fish: { ...config.fish }
    })
    setApiKey('')
    saveSettings.reset()
    setDialogOpen(true)
  }

  const saveDialog = (): void => {
    if (!draft || draft.engine === 'system') return
    saveSettings.mutate(
      {
        config: draft,
        ...(apiKey.trim() ? { apiKey: { provider: draft.engine, value: apiKey } } : {})
      },
      {
        onSuccess: () => {
          setDialogOpen(false)
          setApiKey('')
        }
      }
    )
  }

  return (
    <SettingsSection title="朗读" description="配置词条选中文本和划词结果的朗读服务">
      <SettingsList className="mb-3">
        <SettingsRow label="语音服务">
          <select
            aria-label="语音服务"
            className="h-9 w-56 max-w-[60vw] rounded-md border border-input bg-background px-3 text-sm"
            disabled={!config || saveConfig.isPending}
            onChange={(event) => {
              if (!config) return
              saveConfig.mutate({ ...config, engine: event.target.value as TtsEngineId })
            }}
            value={config?.engine ?? 'system'}
          >
            {Object.entries(labels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </SettingsRow>
      </SettingsList>

      {config?.engine === 'system' && (
        <SettingsList>
          <SettingsRow label="系统音色" description="朗读词条中的选中文本和划词结果">
            <Popover open={voicePickerOpen} onOpenChange={setVoicePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  aria-expanded={voicePickerOpen}
                  aria-label="系统音色"
                  className="w-56 max-w-[60vw] min-w-20 justify-between border border-input bg-background font-normal shadow-xs hover:bg-background"
                  disabled={saveVoice.isPending}
                  role="combobox"
                  variant="outline"
                >
                  <span className="truncate">{selectedVoiceLabel}</span>
                  <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command>
                  <CommandInput placeholder="搜索音色..." />
                  <CommandList className="max-h-[min(18rem,50vh)]">
                    <CommandEmpty>没有找到匹配的音色。</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="自动选择 系统默认"
                        onSelect={() =>
                          saveVoice.mutate(null, { onSuccess: () => setVoicePickerOpen(false) })
                        }
                      >
                        <Check
                          className={
                            config.systemVoiceUri ? 'size-4 opacity-0' : 'size-4 opacity-100'
                          }
                        />
                        <span>系统默认</span>
                      </CommandItem>
                      {voices.map((voice) => (
                        <CommandItem
                          key={voice.uri}
                          value={`${voice.name} ${voice.lang} ${voice.uri}`}
                          onSelect={() =>
                            saveVoice.mutate(voice.uri, {
                              onSuccess: () => setVoicePickerOpen(false)
                            })
                          }
                        >
                          <Check
                            className={
                              config.systemVoiceUri === voice.uri
                                ? 'size-4 opacity-100'
                                : 'size-4 opacity-0'
                            }
                          />
                          <span className="truncate">
                            {voice.name} · {voice.lang}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </SettingsRow>
        </SettingsList>
      )}

      {provider && (
        <SettingsList>
          <SettingsRow
            label={labels[provider]}
            description={configured ? '已配置语音服务' : '配置未完成'}
          >
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={openDialog}>
                配置
              </Button>
              <TtsPlaybackButton key={provider} disabled={!configured} />
            </div>
          </SettingsRow>
        </SettingsList>
      )}
      
      {config?.engine === 'system' && voiceQuery.isSuccess && voices.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">未检测到可用的本机语音。</p>
      )}
      {error && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>配置 {provider ? labels[provider] : ''}朗读</DialogTitle>
          </DialogHeader>
          {draft && provider && (
            <div className="max-h-[60dvh] space-y-4 overflow-y-auto py-2">
              {provider === 'openai-compatible' && (
                <>
                  <Field
                    label="服务地址"
                    value={draft.openai.baseUrl}
                    placeholder="https://api.openai.com/v1"
                    onChange={(value) =>
                      setDraft({ ...draft, openai: { ...draft.openai, baseUrl: value } })
                    }
                  />
                  <Field
                    label="模型"
                    value={draft.openai.model}
                    placeholder="tts-1"
                    onChange={(value) =>
                      setDraft({ ...draft, openai: { ...draft.openai, model: value } })
                    }
                  />
                  <Field
                    label="音色"
                    value={draft.openai.voice}
                    placeholder="alloy"
                    onChange={(value) =>
                      setDraft({ ...draft, openai: { ...draft.openai, voice: value } })
                    }
                  />
                </>
              )}
              {provider === 'elevenlabs' && (
                <>
                  <Field
                    label="模型"
                    value={draft.elevenlabs.model}
                    placeholder="eleven_multilingual_v2"
                    onChange={(value) =>
                      setDraft({ ...draft, elevenlabs: { ...draft.elevenlabs, model: value } })
                    }
                  />
                  <Field
                    label="Voice ID"
                    value={draft.elevenlabs.voiceId}
                    placeholder="ElevenLabs 音色 ID"
                    onChange={(value) =>
                      setDraft({ ...draft, elevenlabs: { ...draft.elevenlabs, voiceId: value } })
                    }
                  />
                </>
              )}
              {provider === 'azure-speech' && (
                <>
                  <Field
                    label="区域"
                    value={draft.azure.region}
                    placeholder="例如 eastus"
                    onChange={(value) =>
                      setDraft({ ...draft, azure: { ...draft.azure, region: value } })
                    }
                  />
                  <Field
                    label="音色"
                    value={draft.azure.voice}
                    placeholder="en-US-JennyNeural"
                    onChange={(value) =>
                      setDraft({ ...draft, azure: { ...draft.azure, voice: value } })
                    }
                  />
                </>
              )}
              {provider === 'fish-audio' && (
                <>
                  <Field
                    label="模型"
                    value={draft.fish.model}
                    placeholder="s2.1-pro-free"
                    onChange={(value) =>
                      setDraft({ ...draft, fish: { ...draft.fish, model: value } })
                    }
                  />
                  <Field
                    label="音色 ID（可选）"
                    value={draft.fish.voiceId}
                    placeholder="留空使用默认音色"
                    onChange={(value) =>
                      setDraft({ ...draft, fish: { ...draft.fish, voiceId: value } })
                    }
                  />
                </>
              )}
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">
                  API Key{provider === 'openai-compatible' ? '（本地服务可留空）' : ''}
                </span>
                <Input
                  autoComplete="off"
                  type="password"
                  value={apiKey}
                  placeholder={
                    credentialsQuery.data?.[provider] ? '已配置，留空以保留' : '输入 API Key'
                  }
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              {saveSettings.error && (
                <p className="text-xs text-destructive" role="alert">
                  {saveSettings.error.message}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={saveSettings.isPending} onClick={saveDialog}>
              {saveSettings.isPending ? '保存中…' : '保存配置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}

function Field({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
