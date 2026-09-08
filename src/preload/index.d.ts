import type { ToastPayload } from '../shared/notification'
import type { TtsConfig, TtsSaveConfigRequest } from '../shared/tts'
import type { DeepLinkIntent } from '../shared/deep-link'
import type {
  CustomCssEditorBounds,
  CustomCssEditorSearchResult,
  CustomCssEditorState,
  CustomCssEditorTheme
} from '../shared/custom-css-editor'

declare global {
  interface Window {
    dictolCustomCssEditor: {
      getState: () => Promise<CustomCssEditorState | null>
      randomEntry: () => Promise<CustomCssEditorState>
      searchEntry: (term: string) => Promise<CustomCssEditorSearchResult>
      setPreviewBounds: (bounds: CustomCssEditorBounds) => void
      setPreviewTheme: (theme: CustomCssEditorTheme) => void
      openDevTools: () => void
      previewCss: (css: string) => void
      save: (css: string) => Promise<void>
      onState: (callback: (state: CustomCssEditorState) => void) => () => void
    }
    dictol: {
      platform: NodeJS.Platform
      dictionaries: {
        list: () => Promise<
          {
            id: string
            name: string
            description: string | null
            iconUrl: string | null
            customCss: string
            recordCount: string | null
            status: 'pending' | 'importing' | 'ready' | 'error'
            external: boolean
            createdAt: string
            updatedAt: string
          }[]
        >
        listReady: () => Promise<
          {
            id: string
            name: string
            description: string | null
            recordCount: string | null
            status: 'ready'
            createdAt: string
            updatedAt: string
          }[]
        >
        selectFile: () => Promise<{
          mdxPath: string
          files: {
            sourcePath: string
            relativePath: string
            fileSize: number
            required: boolean
          }[]
        } | null>
        getInfo: (dictionaryId: string) => Promise<{
          title: string
          description: string
          dictionaryFileNames: string[]
          entryCount: string
          version: string
          engineVersion: number
          requiredVersion: number | null
          format: string
          encoding: string
          encrypted: number
          keyCaseSensitive: boolean
          stripKey: boolean
        }>
        import: (request: {
          mdxPath: string
          copyFiles: boolean
          selectedRelativePaths: string[]
        }) => Promise<{
          id: string
          name: string
          status: 'importing'
          directory: string
          files: {
            id: string
            name: string
            type: 'mdx' | 'mdd'
          }[]
        }>
        delete: (dictionaryId: string) => Promise<void>
        openDirectory: (dictionaryId: string) => Promise<void>
        reorder: (dictionaryIds: string[]) => Promise<void>
        updateName: (dictionaryId: string, name: string) => Promise<void>
        openCustomCssEditor: (dictionaryId: string) => Promise<void>
        updateCustomCss: (dictionaryId: string, customCss: string) => Promise<void>
      }
      onlineDictionaries: {
        list: () => Promise<
          {
            id: string
            name: string
            faviconUrl: string
            urlTemplate: string
          }[]
        >
        add: (input: { name: string; faviconUrl: string; urlTemplate: string }) => Promise<{
          id: string
          name: string
          faviconUrl: string
          urlTemplate: string
        }>
        remove: (id: string) => Promise<void>
        reorder: (ids: string[]) => Promise<void>
      }
      entries: {
        search: (
          prefix: string,
          limit?: number
        ) => Promise<
          {
            word: string
            normalizedWord: string
            dictionaryCount: number
          }[]
        >
        lookup: (term: string) => Promise<{
          word: string
          normalizedWord: string
          dictionaries: {
            entryId: string
            dictionaryId: string
            dictionaryName: string
            dictionaryIconUrl: string | null
          }[]
        } | null>
      }
      history: {
        list: () => Promise<
          {
            id: string
            term: string
            queryCount: number
            lastQueriedAt: string
          }[]
        >
        record: (term: string) => Promise<void>
        clear: () => Promise<void>
        onChanged: (callback: () => void) => () => void
      }
      wordbooks: {
        list: () => Promise<
          {
            id: string
            name: string
            isDefault: boolean
            wordCount: number
            createdAt: string
            updatedAt: string
          }[]
        >
        create: (name: string) => Promise<{
          id: string
          name: string
          isDefault: boolean
          wordCount: number
          createdAt: string
          updatedAt: string
        }>
        listWords: (
          wordbookId?: string,
          page?: number,
          pageSize?: number
        ) => Promise<{
          items: {
            id: string
            wordbookId: string
            wordbookName: string
            word: string
            star: number
            dictionaryWord: string | null
            phonetic: string | null
            definition: string | null
            translation: string | null
            ecdictVersion: string | null
            createdAt: string
            updatedAt: string
          }[]
          total: number
        }>
        filterWords: (
          keyword: string,
          wordbookId?: string,
          page?: number,
          pageSize?: number
        ) => Promise<{
          items: {
            id: string
            wordbookId: string
            wordbookName: string
            word: string
            star: number
            dictionaryWord: string | null
            phonetic: string | null
            definition: string | null
            translation: string | null
            ecdictVersion: string | null
            createdAt: string
            updatedAt: string
          }[]
          total: number
        }>
        addWord: (
          word: string,
          star?: number
        ) => Promise<{
          id: string
          wordbookId: string
          wordbookName: string
          word: string
          star: number
          dictionaryWord: string | null
          phonetic: string | null
          definition: string | null
          translation: string | null
          ecdictVersion: string | null
          createdAt: string
          updatedAt: string
        }>
        importWords: (
          text: string,
          wordbookId?: string
        ) => Promise<{
          imported: number
          matched: number
          unmatched: number
          wordbookId: string
          wordbookName: string
        }>
        toggleStar: (word: string) => Promise<void>
        unStarWord: (word: string) => Promise<void>
        isStarred: (word: string) => Promise<boolean>
        updateStar: (word: string, star: number) => Promise<void>
        moveWords: (wordIds: string[], destinationWordbookId: string) => Promise<void>
        export: (
          request:
            | { scope: 'all' }
            | { scope: 'wordbook'; wordbookId: string }
            | { scope: 'selected'; wordIds: string[] },
          directoryPath: string
        ) => Promise<{ started: boolean }>
        getExportStatus: () => Promise<{
          state: 'idle' | 'exporting' | 'completed' | 'error'
          destinationPath: string | null
          error: string | null
        }>
        onExportStatus: (
          callback: (status: {
            state: 'idle' | 'exporting' | 'completed' | 'error'
            destinationPath: string | null
            error: string | null
          }) => void
        ) => () => void
        selectDirectory: () => Promise<string | null>
        deleteWordbook: (wordbookId: string) => Promise<void>
        renameWordbook: (wordbookId: string, name: string) => Promise<void>
      }
      app: {
        getVersion: () => Promise<string | null>
        onDeepLink: (callback: (intent: DeepLinkIntent) => void) => () => void
        onFocusSearch: (callback: () => void) => () => void
        onShowFindBar: (callback: () => void) => () => void
      }
      keyboard: {
        getStatus: () => Promise<{ shortcut: string; registered: boolean } | null>
        setMainWindowShortcut: (shortcut: string) => Promise<{
          ok: boolean
          status: { shortcut: string; registered: boolean }
          error?: string
        } | null>
      }
      notifications: {
        onToast: (callback: (payload: ToastPayload) => void) => () => void
      }
      tts: {
        getConfig: () => Promise<TtsConfig | null>
        saveConfig: (request: TtsSaveConfigRequest) => Promise<TtsConfig | null>
      }
      aiLookup: {
        getConfig: () => Promise<{
          enabled: boolean
          provider: 'openai-compatible'
          baseUrl: string
          model: string
          hasApiKey: boolean
        } | null>
        saveConfig: (request: {
          enabled: boolean
          provider: 'openai-compatible'
          baseUrl: string
          model: string
          apiKey?: string
        }) => Promise<{
          enabled: boolean
          provider: 'openai-compatible'
          baseUrl: string
          model: string
          hasApiKey: boolean
        } | null>
        startChat: (request: {
          messages: Array<{ role: 'user' | 'assistant'; content: string }>
          promptTarget?: 'sidebar' | 'selection-toolbar' | 'translation'
          translation?: {
            sourceLanguage: '中文' | 'English' | '日本語' | '한국어' | 'Français' | 'Deutsch'
            targetLanguage: '中文' | 'English' | '日本語' | '한국어' | 'Français' | 'Deutsch'
          }
          languageTask?: {
            sourceText: string
            task?:
              'english-lexical' | 'chinese-lexical' | 'english-to-chinese' | 'classical-to-modern'
          }
        }) => Promise<string | null>
        cancel: (requestId: string) => void
        onEvent: (
          callback: (event: {
            requestId: string
            type: 'task' | 'delta' | 'done' | 'error'
            task?:
              'english-lexical' | 'chinese-lexical' | 'english-to-chinese' | 'classical-to-modern'
            text?: string
            message?: string
          }) => void
        ) => () => void
      }
      searchPopover: {
        show: () => void
        hide: () => void
        setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
        update: (
          query: string,
          items: { word: string; description: string; recent: boolean }[],
          selectedIndex: number,
          status?: 'loading' | 'empty'
        ) => void
        onSelect: (callback: (word: string) => void) => () => void
        onQueryChange: (callback: (query: string) => void) => () => void
        onSubmit: (callback: (query: string) => void) => () => void
        onDismiss: (callback: () => void) => () => void
        onShown: (callback: () => void) => () => void
        onHidden: (callback: () => void) => () => void
      }
      wordCapture: {
        getStatus: () => Promise<{
          supported: boolean
          limitation: string | null
          trusted: boolean
          registered: boolean
          shortcut: string
          lookupWordOnSelection: boolean
          excludedPrograms: string[]
        } | null>
        requestAccess: () => Promise<{
          supported: boolean
          limitation: string | null
          trusted: boolean
          registered: boolean
          shortcut: string
          lookupWordOnSelection: boolean
          excludedPrograms: string[]
        } | null>
        openInputMonitoringSettings: () => Promise<{
          ok: boolean
          error?: string
        } | null>
        setShortcut: (shortcut: string) => Promise<{
          ok: boolean
          status: {
            supported: boolean
            limitation: string | null
            trusted: boolean
            registered: boolean
            shortcut: string
            lookupWordOnSelection: boolean
            excludedPrograms: string[]
          }
          error?: string
        } | null>
        setSelectionEnabled: (enabled: boolean) => Promise<{
          ok: boolean
          status: {
            supported: boolean
            limitation: string | null
            trusted: boolean
            registered: boolean
            shortcut: string
            lookupWordOnSelection: boolean
            excludedPrograms: string[]
          }
          error?: string
        } | null>
        removeExcludedProgram: (programName: string) => Promise<{
          ok: boolean
          status: {
            supported: boolean
            limitation: string | null
            trusted: boolean
            registered: boolean
            shortcut: string
            lookupWordOnSelection: boolean
            excludedPrograms: string[]
          }
          error?: string
        } | null>
        onEvent: (
          callback: (
            event:
              | { type: 'lookup'; text: string }
              | { type: 'permission-required' }
              | { type: 'empty' }
              | { type: 'error'; message: string }
          ) => void
        ) => () => void
      }
      dictionaryView: {
        show: (entryId: string) => Promise<void>
        hide: () => void
        showFindBar: () => void
        setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
        onLoadingChanged: (callback: (isLoading: boolean) => void) => () => void
        onLookupWord: (callback: (word: string) => void) => () => void
        onExplainWithAi: (callback: (text: string) => void) => () => void
      }
      embedBrowser: {
        load: (url: string) => Promise<void>
        setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
        hide: () => void
        onUrlChanged: (callback: (url: string) => void) => () => void
        onLoadingChanged: (callback: (isLoading: boolean) => void) => () => void
      }
    }
  }
}

export {}
