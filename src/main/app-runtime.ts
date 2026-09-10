import type { BrowserWindow } from 'electron'

import { AppConfigStore, type AppConfig } from './app-config'
import { AiLookupService } from './ai-service'
import { BuiltInLexiconService } from './built-in-lexicon-service'
import { initDrizzleDB, type DictolDatabase, type SqliteDatabase } from './db/drizzle'
import { getDatabasePath, getMigrationsPath } from './db/paths'
import { DBService } from './db-service'
import { MdictResourceManager } from './mdict-resource-manager'
import { ResourceCache } from './resource-cache'
import { SelectionHookService } from './selection-hook-service'
import { ShortcutRegister } from './shortcut-register'
import { TrayManager } from './tray-manager'
import { WindowManager } from './window-manager'
import { MainWindowShortcutRouter } from './main-window-shortcut-router'
import { AdBlockService } from './ad-block-service'
import type { DictionaryLayout } from '../shared/dictionary-layout'

export const LOOKUP_WORD_ON_SHORTCUT = 'lookupWordOnShortcut'
export const SHOW_MAIN_WINDOW_SHORTCUT = 'showMainWindow'

type MainWindowInitializer = (mainWindow: BrowserWindow) => void

export class AppRuntime {
  private initialized = false
  private disposed = false
  db: DictolDatabase | undefined
  dbService: DBService | undefined
  private dbConnection: SqliteDatabase | undefined
  private _mdictResourceManager: MdictResourceManager | undefined
  private mainWindowInitializer: MainWindowInitializer | undefined
  windowManager: WindowManager = new WindowManager()
  resourceCache: ResourceCache = new ResourceCache()
  builtInLexicon: BuiltInLexiconService | undefined
  appConfig: AppConfigStore = new AppConfigStore()
  aiLookupService: AiLookupService = new AiLookupService(this.appConfig)
  selectionHookService: SelectionHookService = new SelectionHookService()
  shortcutRegister: ShortcutRegister = new ShortcutRegister()
  trayManager: TrayManager = new TrayManager()
  mainWindowShortcutRouter: MainWindowShortcutRouter | undefined
  adBlockService: AdBlockService = new AdBlockService()
  dictionaryLayout: DictionaryLayout = 'single'

  get isInitialized(): boolean {
    return this.initialized
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  get mainWindow(): BrowserWindow | undefined {
    const window = this.windowManager.mainWindow
    return window && !window.isDestroyed() ? window : undefined
  }

  get mdictResourceManager(): MdictResourceManager {
    if (!this._mdictResourceManager) throw new Error('MDict 资源管理器尚未初始化')
    return this._mdictResourceManager
  }

  get activeDictionaryView():
    import('./web-contents-view-manager').WebContentsViewManager | undefined {
    return this.dictionaryLayout === 'aggregate'
      ? this.windowManager.aggregateDictionaryView
      : this.windowManager.dictionaryView
  }

  initDB(): void {
    const { orm, db: conn } = initDrizzleDB(getDatabasePath(), getMigrationsPath())
    this.db = orm
    try {
      this.builtInLexicon = new BuiltInLexiconService()
    } catch (error) {
      // Keep development and recovery builds usable when the generated asset
      // is absent. Packaged releases must include resources/ecdict/ecdict.sqlite.
      console.error(
        'Built-in ECDICT lexicon is unavailable; wordbook entries will not be enriched',
        error
      )
    }
    this.dbService = new DBService(orm, this.builtInLexicon)
    this._mdictResourceManager = new MdictResourceManager(this.dbService)
    this.dbConnection = conn
  }

  closeDB(): void {
    if (this.dbConnection) {
      this.dbConnection.close()
    }
  }

  initWindowManager(): void {
    const mainWindow = this.ensureMainWindow()
    this.trayManager.initialize(mainWindow)
  }

  ensureMainWindow(): BrowserWindow {
    this.windowManager.createMainWindow()
    if (this.dictionaryLayout === 'aggregate') {
      this.windowManager.createAggregateDictionaryView()
    } else {
      this.windowManager.createDictionaryView()
    }
    const mainWindow = this.mainWindow
    if (!mainWindow) throw new Error('主窗口尚未初始化')
    return mainWindow
  }

  activateMainWindow(): void {
    const mainWindow = this.getOrCreateMainWindow()
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
    this.windowManager.focusMainWindowRenderer()
  }

  setMainWindowInitializer(initializer: MainWindowInitializer): void {
    this.mainWindowInitializer = initializer
  }

  getOrCreateMainWindow(): BrowserWindow {
    const existingWindow = this.mainWindow
    if (existingWindow) return existingWindow

    const mainWindow = this.ensureMainWindow()
    if (!this.mainWindowInitializer) {
      throw new Error('主窗口初始化器尚未注册')
    }
    this.mainWindowInitializer(mainWindow)
    return mainWindow
  }

  initialize(): void {
    if (this.initialized) return
    if (this.disposed) throw new Error('AppRuntime 已销毁，不能重新初始化')

    const config = this.appConfig.load()
    this.dictionaryLayout = config.dictionaryLayout
    this.initDB()
    this.adBlockService.initialize()
    this.initWindowManager()
    this.initSelectionHook(config)
    this.registerGlobalShortCuts(config)
    this.initialized = true
  }

  private initSelectionHook(config: AppConfig): void {
    const { lookupWordOnSelection, lookupWordOnShortcut } = config.featureFlags
    if (!lookupWordOnSelection && !lookupWordOnShortcut) {
      this.selectionHookService.stop()
      return
    }

    const capabilities = this.selectionHookService.getCapabilities()
    if (!capabilities.supported) {
      this.selectionHookService.stop()
      console.warn('Selection hook is unsupported in the current environment', capabilities)
      return
    }

    const status = this.selectionHookService.start({
      passiveMode: !lookupWordOnSelection,
      excludedPrograms: config.selection.excludedPrograms
    })

    if (!status.running) {
      console.warn('Selection hook is unavailable; continuing without cross-app lookup')
    }
  }

  private registerGlobalShortCuts(config: AppConfig): void {
    this.registerMainWindowShortcut(config.shortcuts.showMainWindow)

    // 快捷键取词
    if (config.featureFlags.lookupWordOnShortcut) {
      this.registerLookupWordShortCut(config.shortcuts)
    }
  }

  restartMainWindowShortcut(): void {
    this.shortcutRegister.unregister(SHOW_MAIN_WINDOW_SHORTCUT)
    const config = this.appConfig.load()
    this.registerMainWindowShortcut(config.shortcuts.showMainWindow)
  }

  private registerMainWindowShortcut(shortcut: string): void {
    this.shortcutRegister.register(SHOW_MAIN_WINDOW_SHORTCUT, shortcut, {
      handleShortcut: () => this.activateMainWindow()
    })
  }

  private registerLookupWordShortCut({
    lookupWordOnShortcut
  }: {
    lookupWordOnShortcut: string
  }): void {
    if (this.selectionHookService.getStatus().running && lookupWordOnShortcut) {
      this.shortcutRegister.register(
        LOOKUP_WORD_ON_SHORTCUT,
        lookupWordOnShortcut,
        this.selectionHookService
      )
    }
  }

  restartInputServices(): void {
    this.shortcutRegister.unregister(LOOKUP_WORD_ON_SHORTCUT)
    const config = this.appConfig.load()
    this.initSelectionHook(config)
    this.registerGlobalShortCuts(config)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.shortcutRegister.unregisterAll()
    this.mainWindowShortcutRouter?.dispose()
    this.mainWindowShortcutRouter = undefined
    this.selectionHookService.dispose()
    this.trayManager.dispose()
    this.adBlockService.dispose()
    this.windowManager.dispose()
    this.aiLookupService.dispose()
    this._mdictResourceManager?.dispose()
    this._mdictResourceManager = undefined
    this.builtInLexicon?.dispose()
    this.builtInLexicon = undefined
    this.closeDB()
    this.db = undefined
    this.dbService = undefined
    this.dbConnection = undefined
    this.mainWindowInitializer = undefined
    this.initialized = false
  }
}

let appRunTime: AppRuntime | undefined

export function getAppRunTime(): AppRuntime {
  if (appRunTime) return appRunTime

  appRunTime = new AppRuntime()
  return appRunTime
}
