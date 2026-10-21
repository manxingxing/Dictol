import { app, BrowserWindow } from 'electron'
import { NativeSelectionPanel } from './native-selection-panel'

/** Apply ordinary Electron-window behavior to floating BrowserWindow surfaces. */
export function applySelectionWindowBehavior(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, 'screen-saver')
}

/**
 * Show a selection surface without activating Dictol or focusing its main window.
 *
 * Native selection panels and Electron's non-activating explanation panel can
 * be shown without activating Dictol. Other platforms use Electron's normal
 * inactive presentation.
 */
export function showSelectionWindowInactive(
  window: BrowserWindow | NativeSelectionPanel,
  options: { mainWindowToKeepHidden?: BrowserWindow } = {}
): void {
  if (window.isDestroyed()) return

  if (window instanceof NativeSelectionPanel) {
    const appWasHidden = app.isHidden()
    window.showInactive()
    const mainWindow = options.mainWindowToKeepHidden
    if (appWasHidden && mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
    return
  }

  window.showInactive()
  if (process.platform === 'win32') window.moveTop()
}

/**
 * Hide a floating selection window without allowing macOS to promote Dictol's
 * main window as the replacement frontmost window.
 */
export function hideSelectionWindow(
  window: BrowserWindow | NativeSelectionPanel | undefined
): void {
  if (!window || window.isDestroyed()) return

  if (process.platform !== 'darwin') {
    window.hide()
    return
  }

  const nativeHost = window instanceof NativeSelectionPanel ? window.host : window
  const focusableWindows = BrowserWindow.getAllWindows().filter(
    (candidate) =>
      candidate !== nativeHost &&
      !candidate.isDestroyed() &&
      candidate.isVisible() &&
      candidate.isFocusable()
  )
  focusableWindows.forEach((candidate) => candidate.setFocusable(false))
  window.hide()

  setTimeout(() => {
    focusableWindows.forEach((candidate) => {
      if (!candidate.isDestroyed()) candidate.setFocusable(true)
    })
  }, 50)
}
