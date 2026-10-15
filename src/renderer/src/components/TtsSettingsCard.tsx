import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSaveTtsVoice, useSystemTtsVoices, useTtsConfig } from '@/hooks/use-tts-config'

export function TtsSettingsCard(): React.JSX.Element {
  const ttsConfig = useTtsConfig()
  const saveVoice = useSaveTtsVoice()
  const ttsVoices = useSystemTtsVoices()
  const config = ttsConfig.data
  const voices = ttsVoices.data ?? []
  const [voicePickerOpen, setVoicePickerOpen] = useState(false)

  const selectVoice = (systemVoiceUri: string | null): void => {
    saveVoice.mutate(systemVoiceUri, { onSuccess: () => setVoicePickerOpen(false) })
  }

  const error = ttsConfig.error?.message ?? saveVoice.error?.message ?? ttsVoices.error?.message
  const selectedVoice = voices.find((voice) => voice.uri === config?.systemVoiceUri)
  const selectedVoiceLabel = selectedVoice
    ? `${selectedVoice.name} · ${selectedVoice.lang}`
    : config?.systemVoiceUri
      ? '已保存的音色不可用'
      : '系统默认'

  return (
    <SettingsSection title="朗读">
      <SettingsList>
        <SettingsRow
          label="系统音色"
          description="朗读词条中的选中文本和划词结果"
          control={
            <Popover open={voicePickerOpen} onOpenChange={setVoicePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  aria-expanded={voicePickerOpen}
                  aria-label="系统音色"
                  className="w-56 max-w-[60vw] min-w-20 justify-between border border-input bg-background font-normal shadow-xs hover:bg-background"
                  disabled={!config || saveVoice.isPending}
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
                        disabled={saveVoice.isPending}
                        value="自动选择 系统默认"
                        onSelect={() => selectVoice(null)}
                      >
                        <Check
                          className={
                            config?.systemVoiceUri ? 'size-4 opacity-0' : 'size-4 opacity-100'
                          }
                        />
                        <span className="truncate">系统默认</span>
                      </CommandItem>
                      {voices.map((voice) => (
                        <CommandItem
                          disabled={saveVoice.isPending}
                          key={voice.uri}
                          value={`${voice.name} ${voice.lang} ${voice.uri}`}
                          onSelect={() => selectVoice(voice.uri)}
                        >
                          <Check
                            className={
                              config?.systemVoiceUri === voice.uri
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
          }
        />
      </SettingsList>
      {ttsVoices.isSuccess && voices.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">未检测到上述语言的本机语音。</p>
      )}
      {error && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}
