import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

import type { AppMenuAction } from '../shared/app-menu'
import { OCR_SUPPORTED } from '../shared/ocr'
import type { AppRuntime } from './app-runtime'
import { parseDictionaryEntryUrl } from './dictionary-entry-url'

export function installAppMenu(runtime: AppRuntime): void {
  const send = (action: AppMenuAction): void => {
    runtime.activateMainWindow()
    const window = runtime.mainWindow
    if (!window) return
    const deliver = (): void => {
      if (!window.isDestroyed()) window.webContents.send('app:menu-action', action)
    }
    if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', deliver)
    else deliver()
  }
  const item = (
    label: string,
    action: AppMenuAction,
    accelerator?: string
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send(action)
  })
  const isMac = process.platform === 'darwin'
  const switchDictionaryItem = (
    label: string,
    accelerator: string,
    direction: 'left' | 'right'
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: (_item, focusedWindow) => {
      const mainWindow = runtime.mainWindow
      const view = runtime.activeDictionaryView
      if (!mainWindow || focusedWindow !== mainWindow || !view?.isVisible) return

      const dictionaryId = parseDictionaryEntryUrl(view.getURL())?.dictionaryId
      if (dictionaryId === undefined) return
      mainWindow.webContents.send('dictionary-view:switch-dictionary', {
        direction,
        dictionaryId: String(dictionaryId)
      })
    }
  })
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Dictol',
            submenu: [
              { role: 'about' as const, label: '关于 Dictol' },
              item('设置…', 'settings', 'CommandOrControl+,'),
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : [
          {
            label: '文件',
            submenu: [
              item('设置…', 'settings', 'CommandOrControl+,'),
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]),
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: '在解释中查找',
          accelerator: 'CommandOrControl+F',
          click: (_item, focusedWindow) => {
            const mainWindow = runtime.mainWindow
            if (mainWindow && focusedWindow === mainWindow) {
              mainWindow.webContents.send('app:show-find-bar')
            }
          }
        }
      ]
    },
    {
      label: '导航',
      submenu: [
        item('查词', 'search', 'CommandOrControl+1'),
        item('历史', 'history', 'CommandOrControl+2'),
        item('生词本', 'wordbooks', 'CommandOrControl+3'),
        item('摘抄', 'excerpts', 'CommandOrControl+4'),
        item('翻译', 'translation', 'CommandOrControl+5'),
        { type: 'separator' },
        {
          label: '聚焦查词框',
          accelerator: 'CommandOrControl+K',
          click: (_item, focusedWindow) => {
            const mainWindow = runtime.mainWindow
            if (!mainWindow || focusedWindow !== mainWindow) return

            const popover = runtime.windowManager.searchPopoverView
            if (popover?.isVisible && !popover.isDestroyed && popover.webContents.isFocused()) {
              popover.send('search-popover:focus-input')
              return
            }

            runtime.windowManager.focusMainWindowRenderer()
            mainWindow.webContents.send('app:focus-search')
          }
        },
        { type: 'separator' },
        item('后退', 'back', isMac ? 'Command+[' : 'Alt+Left'),
        item('前进', 'forward', isMac ? 'Command+]' : 'Alt+Right'),
        ...(runtime.dictionaryLayout === 'single'
          ? [
              { type: 'separator' as const },
              switchDictionaryItem('切换到上一本词典', 'CommandOrControl+Left', 'left'),
              switchDictionaryItem('切换到下一本词典', 'CommandOrControl+Right', 'right')
            ]
          : [])
      ]
    },
    {
      label: '词典',
      submenu: [
        item('本地词典', 'local-dictionaries'),
        item('在线词典', 'online-dictionaries'),
        item('词典分组', 'dictionary-groups')
      ]
    },
    {
      label: '功能',
      submenu: [
        ...(OCR_SUPPORTED
          ? [
              {
                label: '截图翻译',
                click: () => void runtime.actions.screenshotTranslation.toggleSelector()
              }
            ]
          : []),
        {
          label: '翻译剪贴板内容',
          click: () => void runtime.actions.clipboardTranslation.translateFromClipboard()
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        item('显示/隐藏侧边栏', 'toggle-sidebar'),
        item('切换紧凑模式', 'toggle-compact-mode'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu', label: '窗口' },
    ...(!isMac ? [{ label: '帮助', submenu: [item('关于 Dictol', 'about')] }] : [])
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  if (process.platform === 'win32') {
    const hideMenuBar = (window: BrowserWindow): void => {
      window.setAutoHideMenuBar(false)
      window.setMenuBarVisibility(false)
    }
    BrowserWindow.getAllWindows().forEach(hideMenuBar)
    app.on('browser-window-created', (_event, window) => hideMenuBar(window))
  }
}
