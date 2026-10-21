export const MAIN_WINDOW_TITLEBAR_HEIGHT = 44
export const MAIN_WINDOW_TITLEBAR_CONTROL_HEIGHT = 30

export function getMainWindowChromeMaterial(
  platform: NodeJS.Platform,
  systemVersion: string
): 'vibrancy' | 'mica' | null {
  if (platform === 'darwin') return 'vibrancy'
  if (platform === 'win32' && Number(systemVersion.split('.')[2]) >= 22621) return 'mica'
  return null
}
