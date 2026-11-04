import { AboutSettingsCard } from '@/components/AboutSettingsCard'
import { StorageSettingsCard } from '@/components/StorageSettingsCard'

export function AboutPage(): React.JSX.Element {
  return (
    <>
      <AboutSettingsCard />
      <StorageSettingsCard />
    </>
  )
}
