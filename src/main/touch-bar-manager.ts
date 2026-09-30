import { BrowserWindow, nativeImage, TouchBar } from 'electron'

import type { TouchBarState } from '../shared/touch-bar'

type IconPathResolver = (dictionaryId: string) => Promise<string | null>

const TOUCH_BAR_ICON_SIZE = 18

export class TouchBarManager {
  private visible = false
  private state: TouchBarState = {
    word: null,
    starred: false,
    dictionaries: []
  }
  private renderVersion = 0

  constructor(
    private readonly getMainWindow: () => BrowserWindow | undefined,
    private readonly resolveIconPath: IconPathResolver,
    private readonly onFocusSearch: () => void,
    private readonly onToggleStar: () => void,
    private readonly onSelectDictionary: (dictionaryId: string) => void
  ) {}

  setSearchPageVisible(visible: boolean): void {
    this.visible = visible
    this.scheduleRender()
  }

  updateState(state: TouchBarState): void {
    this.state = state
    this.scheduleRender()
  }

  private scheduleRender(): void {
    const version = ++this.renderVersion
    void this.render(version)
  }

  private async render(version: number): Promise<void> {
    if (process.platform !== 'darwin') return

    const mainWindow = this.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return

    if (!this.visible) {
      mainWindow.setTouchBar(null)
      return
    }

    const state = this.state
    const dictionaryButtons = await Promise.all(
      state.dictionaries.map(async (dictionary) => {
        let iconPath: string | null = null
        try {
          iconPath = await this.resolveIconPath(dictionary.dictionaryId)
        } catch {
          // A dictionary can be removed while its previous search result is still visible.
        }
        const image = iconPath ? nativeImage.createFromPath(iconPath) : null
        const icon =
          image && !image.isEmpty()
            ? image.resize({ width: TOUCH_BAR_ICON_SIZE, height: TOUCH_BAR_ICON_SIZE })
            : undefined
        const initial = Array.from(dictionary.dictionaryName.trim())[0] ?? '?'

        const { TouchBarButton } = TouchBar
        return new TouchBarButton({
          label: icon ? '' : initial,
          icon,
          iconPosition: 'overlay',
          accessibilityLabel: dictionary.dictionaryName,
          click: () => this.onSelectDictionary(dictionary.dictionaryId)
        })
      })
    )

    if (version !== this.renderVersion || !this.visible || mainWindow.isDestroyed()) {
      return
    }

    const { TouchBarButton } = TouchBar
    const focusButton = new TouchBarButton({
      label: '搜索',
      accessibilityLabel: '聚焦搜索框',
      click: this.onFocusSearch
    })
    const starButton = new TouchBarButton({
      label: state.starred ? '★' : '☆',
      accessibilityLabel: state.starred ? '取消收藏当前词条' : '收藏当前词条',
      enabled: Boolean(state.word),
      click: this.onToggleStar
    })
    const dictionaryControl = dictionaryButtons.length > 0 ? dictionaryButtons : []

    mainWindow.setTouchBar(
      new TouchBar({
        items: [focusButton, starButton, ...dictionaryControl]
      })
    )
  }
}
