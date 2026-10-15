export const SELECTION_TOOLBAR_WIDTH = 300
export const SELECTION_TOOLBAR_HEIGHT = 44
export const SELECTION_TOOLBAR_WINDOWS_SHADOW_MARGIN = 6

export function getSelectionToolbarWindowSize(platform: string): { width: number; height: number } {
  if (platform !== 'win32')
    return { width: SELECTION_TOOLBAR_WIDTH, height: SELECTION_TOOLBAR_HEIGHT }

  const shadowSpace = SELECTION_TOOLBAR_WINDOWS_SHADOW_MARGIN * 2
  return {
    width: SELECTION_TOOLBAR_WIDTH + shadowSpace,
    height: SELECTION_TOOLBAR_HEIGHT + shadowSpace
  }
}

export type SelectionToolbarPayload = {
  requestId: number
  word: string
  programName: string
  canExclude: boolean
  canCaptureExcerpt: boolean
  canTranslate: boolean
}

export type ExternalExcerptCapture = {
  text: string
  sourceApp: string
  aiEnabled: boolean
}
