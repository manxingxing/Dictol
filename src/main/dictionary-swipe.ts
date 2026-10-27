import type { BrowserWindow } from 'electron'
import type { WebContentsViewManager } from './web-contents-view-manager'

/** Forward Chromium's finger-scroll boundaries to the entry preload. */
export function attachDictionarySwipePhases(
  view: WebContentsViewManager,
  owner: BrowserWindow
): void {
  const webContents = view.webContents
  const onInput = (_event: Electron.Event, input: Electron.InputEvent): void => {
    if (input.type === 'gestureScrollBegin') webContents.send('dictionary-swipe:begin')
    if (input.type === 'gestureScrollEnd') webContents.send('dictionary-swipe:end')
  }
  const cancel = (): void => {
    if (!webContents.isDestroyed()) webContents.send('dictionary-swipe:cancel')
  }
  const onVisibilityChanged = (visible: boolean): void => {
    if (!visible) cancel()
  }

  webContents.on('input-event', onInput)
  webContents.on('blur', cancel)
  owner.on('blur', cancel)
  owner.on('hide', cancel)
  view.eventBus.on('visibility-changed', onVisibilityChanged)
  webContents.once('destroyed', () => {
    webContents.off('input-event', onInput)
    webContents.off('blur', cancel)
    owner.off('blur', cancel)
    owner.off('hide', cancel)
    view.eventBus.off('visibility-changed', onVisibilityChanged)
  })
}
