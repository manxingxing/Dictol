import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { useOcrConfig, useSaveOcrConfig } from '@/hooks/use-ocr-config'
import {
  OCR_ENGINE_OPTIONS,
  OCR_LANGUAGE_OPTIONS,
  CAPTURE_ENGINE_OPTIONS,
  type CaptureEngine,
  type OcrEngine,
  type OcrLanguage
} from '../../../../shared/ocr-settings'

export function OcrSettingsPage(): React.JSX.Element {
  const configQuery = useOcrConfig()
  const saveConfig = useSaveOcrConfig()
  const config = configQuery.data
  const error = configQuery.error?.message ?? saveConfig.error?.message

  return (
    <>
      <SettingsSection title="文字识别">
        <SettingsList>
          <SettingsRow label="OCR 引擎">
            <select
              aria-label="OCR 引擎"
              className="h-9 w-56 max-w-[60vw] rounded-md border border-input bg-background px-3 text-sm"
              disabled={!config || saveConfig.isPending}
              value={config?.engine ?? 'system'}
              onChange={(event) => {
                if (!config) return
                saveConfig.mutate({ ...config, engine: event.target.value as OcrEngine })
              }}
            >
              {OCR_ENGINE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </SettingsRow>
          <SettingsRow
            label="识别语言"
            description="跟随系统时，按 Windows 用户语言偏好选择识别语言"
          >
            <select
              aria-label="OCR 识别语言"
              className="h-9 w-56 max-w-[60vw] rounded-md border border-input bg-background px-3 text-sm"
              disabled={!config || saveConfig.isPending}
              value={config?.language ?? 'system'}
              onChange={(event) => {
                if (!config) return
                saveConfig.mutate({ ...config, language: event.target.value as OcrLanguage })
              }}
            >
              {OCR_LANGUAGE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </SettingsRow>
        </SettingsList>
      </SettingsSection>
      <SettingsSection title="截屏">
        <SettingsList>
          <SettingsRow label="截屏方案">
            <select
              aria-label="截屏方案"
              className="h-9 w-56 max-w-[60vw] rounded-md border border-input bg-background px-3 text-sm"
              disabled={!config || saveConfig.isPending}
              value={config?.captureEngine ?? 'gdi'}
              onChange={(event) => {
                if (!config) return
                saveConfig.mutate({ ...config, captureEngine: event.target.value as CaptureEngine })
              }}
            >
              {CAPTURE_ENGINE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </SettingsRow>
        </SettingsList>
        {configQuery.isPending && (
          <p className="mt-3 text-sm text-muted-foreground">正在读取 OCR 设置…</p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </SettingsSection>
    </>
  )
}
