import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle
} from '@/components/ui/field'
import { useOcrConfig, useSaveOcrConfig } from '@/hooks/use-ocr-config'
import {
  OCR_ENGINE_OPTIONS,
  OCR_LANGUAGE_OPTIONS,
  OCR_RECOGNITION_MODE_OPTIONS,
  CAPTURE_ENGINE_OPTIONS,
  type CaptureEngine,
  type OcrEngine,
  type OcrLanguage
} from '../../../../shared/ocr-settings'

export function OcrSettingsPage(): React.JSX.Element {
  const configQuery = useOcrConfig()
  const saveConfig = useSaveOcrConfig()
  const config = configQuery.data
  const isMac = window.dictol.platform === 'darwin'
  const macConfig = config && 'recognitionMode' in config ? config : undefined
  const windowsConfig = config && 'language' in config ? config : undefined
  const error = configQuery.error?.message ?? saveConfig.error?.message
  const status = configQuery.isPending ? (
    <p className="mt-3 text-sm text-muted-foreground">正在读取 OCR 设置…</p>
  ) : error ? (
    <p role="alert" className="mt-3 text-sm text-destructive">
      {error}
    </p>
  ) : null

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
          {!isMac && (
            <SettingsRow
              label="识别语言"
              description="跟随系统时，按 Windows 用户语言偏好选择识别语言"
            >
              <select
                aria-label="OCR 识别语言"
                className="h-9 w-56 max-w-[60vw] rounded-md border border-input bg-background px-3 text-sm"
                disabled={!windowsConfig || saveConfig.isPending}
                value={windowsConfig?.language ?? 'system'}
                onChange={(event) => {
                  if (!windowsConfig) return
                  saveConfig.mutate({
                    ...windowsConfig,
                    language: event.target.value as OcrLanguage
                  })
                }}
              >
                {OCR_LANGUAGE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </SettingsRow>
          )}
        </SettingsList>
        {isMac && (
          <>
            <FieldSet className="mt-6 gap-2" disabled={!macConfig} aria-busy={saveConfig.isPending}>
              <FieldLegend variant="label">OCR 识别</FieldLegend>
              {OCR_RECOGNITION_MODE_OPTIONS.map(({ value, label, description }) => (
                <FieldLabel
                  key={value}
                  className="cursor-pointer bg-card has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring dark:has-checked:bg-primary/10 has-disabled:cursor-default has-disabled:opacity-50"
                >
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle id={`ocr-mode-${value}`}>{label}</FieldTitle>
                      <FieldDescription id={`ocr-mode-${value}-description`}>
                        {description}
                      </FieldDescription>
                    </FieldContent>
                    <input
                      type="radio"
                      name="ocr-recognition-mode"
                      value={value}
                      aria-labelledby={`ocr-mode-${value}`}
                      aria-describedby={`ocr-mode-${value}-description`}
                      className="mt-px size-4 shrink-0 accent-primary"
                      checked={(macConfig?.recognitionMode ?? 'accurate') === value}
                      onChange={() => {
                        if (macConfig && !saveConfig.isPending) {
                          saveConfig.mutate({ ...macConfig, recognitionMode: value })
                        }
                      }}
                    />
                  </Field>
                </FieldLabel>
              ))}
            </FieldSet>
            {status}
          </>
        )}
      </SettingsSection>
      {!isMac && (
        <SettingsSection title="截屏">
          <SettingsList>
            <SettingsRow label="截屏方案">
              <select
                aria-label="截屏方案"
                className="h-9 w-56 max-w-[60vw] rounded-md border border-input bg-background px-3 text-sm"
                disabled={!windowsConfig || saveConfig.isPending}
                value={windowsConfig?.captureEngine ?? 'gdi'}
                onChange={(event) => {
                  if (!windowsConfig) return
                  saveConfig.mutate({
                    ...windowsConfig,
                    captureEngine: event.target.value as CaptureEngine
                  })
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
          {status}
        </SettingsSection>
      )}
    </>
  )
}
