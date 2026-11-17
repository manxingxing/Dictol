import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsList, SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import type { OcrEngine } from '../../../../shared/ocr'

const ocrEngineKey = ['ocr', 'engine'] as const

export function OcrSettingsPage(): React.JSX.Element {
  const client = useQueryClient()
  const engine = useQuery({
    queryKey: ocrEngineKey,
    queryFn: async () => {
      const value = await window.dictol.app.getOcrEngine()
      if (!value) throw new Error('无法读取 OCR 设置。')
      return value
    }
  })
  const save = useMutation({
    mutationFn: async (value: OcrEngine) => {
      const saved = await window.dictol.app.saveOcrEngine(value)
      if (!saved) throw new Error('无法保存 OCR 设置。')
      return saved
    },
    onSuccess: (value) => client.setQueryData(ocrEngineKey, value)
  })
  const error = save.error ?? engine.error
  return (
    <SettingsSection title="OCR" description="配置屏幕文字识别引擎">
      <SettingsList>
        <SettingsRow label="识别引擎" description="用于悬停取词和截图翻译">
          <select
            aria-label="识别引擎"
            className="h-9 min-w-44 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
            disabled={!engine.data || save.isPending}
            value={engine.data ?? ''}
            onChange={(event) => save.mutate(event.target.value as OcrEngine)}
          >
            <option value="system">系统 OCR</option>
            <option value="paddle">PaddleOCR</option>
          </select>
        </SettingsRow>
      </SettingsList>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error.message}
        </p>
      )}
    </SettingsSection>
  )
}
