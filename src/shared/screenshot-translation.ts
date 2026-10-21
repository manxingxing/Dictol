export type ScreenshotTranslationStatus = {
  supported: boolean
  enabled: boolean
  shortcut: string
  registered: boolean
}

export type ScreenshotTranslationSettingResult = {
  ok: boolean
  status: ScreenshotTranslationStatus
  error?: string
}
