import { AiLookupSettingsCard } from '@/components/AiLookupSettingsCard'
import { AboutSettingsCard } from '@/components/AboutSettingsCard'
import { AppearanceSettingsCard } from '@/components/AppearanceSettingsCard'
import { KeyboardSettingsCard } from '@/components/KeyboardSettingsCard'
import { ResourceCacheSettingsCard } from '@/components/ResourceCacheSettingsCard'
import { TtsSettingsCard } from '@/components/TtsSettingsCard'
import { WordCaptureSettingsCard } from '@/components/WordCaptureSettingsCard'

export function SettingsPage(): React.JSX.Element {
  return (
    <section className="mx-auto flex max-w-3xl flex-col p-6 sm:p-8">
      <p className="mb-2 text-sm font-medium text-primary">设置</p>
      <h1 className="text-xl font-semibold tracking-tight">应用设置</h1>
      <div className="mt-8">
        <AppearanceSettingsCard />
        <WordCaptureSettingsCard />
        <AiLookupSettingsCard />
        <TtsSettingsCard />
        <KeyboardSettingsCard />
        <ResourceCacheSettingsCard />
        <AboutSettingsCard />
      </div>
    </section>
  )
}
