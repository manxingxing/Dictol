import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { cn } from '@/lib/utils'
import { type ChromeTone, useAppStore } from '@/stores/app-store'
import type { DictionaryLayout } from '../../../shared/dictionary-layout'

export function AppearanceSettingsCard(): React.JSX.Element {
  const chromeTone = useAppStore((state) => state.chromeTone)
  const setChromeTone = useAppStore((state) => state.setChromeTone)
  const [dictionaryLayout, setDictionaryLayout] = useState<DictionaryLayout | ''>('')
  const [isSavingDictionaryLayout, setIsSavingDictionaryLayout] = useState(false)

  useEffect(() => {
    let active = true
    void window.dictol.app.getDictionaryLayout().then((layout) => {
      if (active && layout) setDictionaryLayout(layout)
    })
    return () => {
      active = false
    }
  }, [])

  const handleDictionaryLayoutChange = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ): Promise<void> => {
    const layout = event.target.value as DictionaryLayout
    setIsSavingDictionaryLayout(true)
    try {
      const savedLayout = await window.dictol.app.saveDictionaryLayout(layout)
      if (!savedLayout) return
      setDictionaryLayout(savedLayout)
      window.alert('词典页面布局已保存，需重新启动才能生效。')
    } catch (error) {
      console.error('Failed to save dictionary layout', error)
      window.alert('词典页面布局保存失败，请稍后重试。')
    } finally {
      setIsSavingDictionaryLayout(false)
    }
  }

  return (
    <SettingsSection title="外观" description="选择应用框架的布局和色调">
      <SettingsList>
        <SettingsRow
          label="查词页面布局"
          description="一页展示一个词典解释，或者在一页聚合多个词典解释"
          control={
            <select
              aria-label="查词页面布局"
              className="h-9 min-w-44 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
              disabled={!dictionaryLayout || isSavingDictionaryLayout}
              onChange={(event) => void handleDictionaryLayoutChange(event)}
              value={dictionaryLayout}
            >
              {dictionaryLayoutOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          }
          className="items-start"
        />
        <SettingsRow
          label="框架色调"
          description="浅色和深色模式仍然跟随系统"
          control={
            <div aria-label="应用框架色调" className="grid gap-2 sm:grid-cols-2" role="group">
              {chromeToneOptions.map((option) => {
                const selected = chromeTone === option.value
                return (
                  <Button
                    aria-pressed={selected}
                    className={cn(
                      'h-auto min-w-30 justify-start gap-2 p-2 text-left',
                      selected &&
                        'border-primary/45 bg-primary/8 text-foreground ring-1 ring-primary/20 hover:bg-primary/10'
                    )}
                    key={option.value}
                    onClick={() => setChromeTone(option.value)}
                    type="button"
                    variant="outline"
                  >
                    <span
                      aria-hidden="true"
                      className="appearance-tone-preview size-10 shrink-0"
                      data-tone={option.value}
                    >
                      <span className="appearance-tone-preview__titlebar" />
                      <span className="appearance-tone-preview__rail" />
                      <span className="appearance-tone-preview__content">
                        <span className="appearance-tone-preview__toolbar" />
                        <span className="appearance-tone-preview__pill" />
                        <span className="appearance-tone-preview__message" />
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{option.label}</span>
                    </span>
                  </Button>
                )
              })}
            </div>
          }
          className="items-start"
        />
      </SettingsList>
    </SettingsSection>
  )
}

const chromeToneOptions: Array<{
  value: ChromeTone
  label: string
}> = [
  {
    value: 'neutral',
    label: '中性'
  },
  {
    value: 'moss',
    label: '苔绿'
  }
]

const dictionaryLayoutOptions: Array<{
  value: DictionaryLayout
  label: string
}> = [
  { value: 'single', label: '一页一个词典' },
  { value: 'aggregate', label: '一页多个词典' }
]
