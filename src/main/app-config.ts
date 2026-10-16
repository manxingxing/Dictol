import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { DictionaryLayout } from '../shared/dictionary-layout'
import type { DictionaryDisplay } from '../shared/dictionary-display'
import type { ThemeMode } from '../shared/theme-mode'
import type { TtsConfig } from '../shared/tts'
import {
  SYSTEM_TRANSLATION_PROVIDER_ID,
  TRANSLATION_LANGUAGES,
  type TranslationConfig,
  type TranslationProviderConfig,
  type TranslationProviderKind
} from '../shared/translation'

export type AppConfig = {
  themeMode: ThemeMode
  aggregateLayout: 'vertical' | 'horizontal'
  dictionaryLayout: DictionaryLayout
  dictionaryDisplay: DictionaryDisplay
  featureFlags: {
    lookupWordOnShortcut: boolean
    lookupWordOnSelection: boolean
    ocrLookup: boolean
  }
  shortcuts: {
    lookupWordOnShortcut: string
    showMainWindow: string
    ocrDictionary: string
    ocrAi: string
  }
  selection: {
    dictionaryGroupId: number | undefined
    excludedPrograms: string[]
  }
  aiLookup: {
    enabled: boolean
    provider: 'openai-compatible'
    baseUrl: string
    model: string
  }
  tts: TtsConfig
  translation: TranslationConfig
}

const DEFAULT_CONFIG: AppConfig = {
  themeMode: 'auto',
  aggregateLayout: 'vertical',
  dictionaryLayout: 'single',
  dictionaryDisplay: 'icon',
  featureFlags: {
    lookupWordOnShortcut: true,
    lookupWordOnSelection: false,
    ocrLookup: false
  },
  shortcuts: {
    lookupWordOnShortcut: 'Alt+D',
    showMainWindow: 'CommandOrControl+Alt+D',
    ocrDictionary: 'Alt+S',
    ocrAi: 'Alt+T'
  },
  selection: {
    dictionaryGroupId: undefined,
    excludedPrograms: []
  },
  aiLookup: {
    enabled: false,
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: ''
  },
  tts: {
    engine: 'system',
    systemVoiceUri: null
  },
  translation: {
    targetLanguage: 'zh',
    providers:
      process.platform === 'darwin'
        ? [
            {
              id: SYSTEM_TRANSLATION_PROVIDER_ID,
              kind: 'system',
              name: '系统翻译',
              enabled: true,
              options: {}
            }
          ]
        : []
  }
}

export class AppConfigStore {
  constructor(private readonly configPath = join(app.getPath('userData'), 'config.json')) {}

  load(): AppConfig {
    try {
      const value = JSON.parse(readFileSync(this.configPath, 'utf8')) as unknown
      return parseConfig(value)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.save(DEFAULT_CONFIG)
      } else {
        console.warn('Failed to load app config; using defaults', error)
      }
      return cloneConfig(DEFAULT_CONFIG)
    }
  }

  save(config: AppConfig): void {
    const normalized = parseConfig(config)
    const temporaryPath = `${this.configPath}.tmp`
    mkdirSync(dirname(this.configPath), { recursive: true })
    writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, this.configPath)
  }

  addExcludedProgram(programName: string): AppConfig {
    const normalizedProgram = normalizeProgramName(programName)
    if (!normalizedProgram) throw new Error('无效的程序名称')

    const config = this.load()
    if (
      config.selection.excludedPrograms.some(
        (program) => program.toLocaleLowerCase() === normalizedProgram.toLocaleLowerCase()
      )
    ) {
      return config
    }

    const nextConfig: AppConfig = {
      ...cloneConfig(config),
      selection: {
        dictionaryGroupId: config.selection.dictionaryGroupId,
        excludedPrograms: [...config.selection.excludedPrograms, normalizedProgram]
      }
    }
    this.save(nextConfig)
    return nextConfig
  }

  removeExcludedProgram(programName: string): AppConfig {
    const normalizedProgram = normalizeProgramName(programName)
    if (!normalizedProgram) throw new Error('无效的程序名称')

    const config = this.load()
    const excludedPrograms = config.selection.excludedPrograms.filter(
      (program) => program.toLocaleLowerCase() !== normalizedProgram.toLocaleLowerCase()
    )
    const nextConfig: AppConfig = {
      ...cloneConfig(config),
      selection: { dictionaryGroupId: config.selection.dictionaryGroupId, excludedPrograms }
    }
    this.save(nextConfig)
    return nextConfig
  }
}

function parseConfig(value: unknown): AppConfig {
  if (typeof value !== 'object' || value === null) return cloneConfig(DEFAULT_CONFIG)
  const candidate = value as {
    themeMode?: unknown
    aggregateLayout?: unknown
    dictionaryLayout?: unknown
    dictionaryDisplay?: unknown
    featureFlags?: {
      lookupWordOnShortcut?: unknown
      lookupWordOnSelection?: unknown
      ocrLookup?: unknown
    }
    shortcuts?: {
      lookupWordOnShortcut?: unknown
      showMainWindow?: unknown
      ocrDictionary?: unknown
      ocrAi?: unknown
    }
    selection?: { dictionaryGroupId?: unknown; excludedPrograms?: unknown }
    aiLookup?: {
      enabled?: unknown
      provider?: unknown
      baseUrl?: unknown
      model?: unknown
    }
    tts?: { engine?: unknown; systemVoiceUri?: unknown }
    translation?: { targetLanguage?: unknown; providers?: unknown }
  }

  return {
    themeMode:
      candidate.themeMode === 'light' || candidate.themeMode === 'dark'
        ? candidate.themeMode
        : DEFAULT_CONFIG.themeMode,
    aggregateLayout: candidate.aggregateLayout === 'horizontal' ? 'horizontal' : 'vertical',
    dictionaryLayout:
      candidate.dictionaryLayout === 'aggregate' ? 'aggregate' : DEFAULT_CONFIG.dictionaryLayout,
    dictionaryDisplay:
      candidate.dictionaryDisplay === 'name' || candidate.dictionaryDisplay === 'icon-and-name'
        ? candidate.dictionaryDisplay
        : DEFAULT_CONFIG.dictionaryDisplay,
    featureFlags: {
      lookupWordOnShortcut:
        typeof candidate.featureFlags?.lookupWordOnShortcut === 'boolean'
          ? candidate.featureFlags.lookupWordOnShortcut
          : DEFAULT_CONFIG.featureFlags.lookupWordOnShortcut,
      lookupWordOnSelection:
        typeof candidate.featureFlags?.lookupWordOnSelection === 'boolean'
          ? candidate.featureFlags.lookupWordOnSelection
          : DEFAULT_CONFIG.featureFlags.lookupWordOnSelection,
      ocrLookup:
        typeof candidate.featureFlags?.ocrLookup === 'boolean'
          ? candidate.featureFlags.ocrLookup
          : DEFAULT_CONFIG.featureFlags.ocrLookup
    },
    shortcuts: {
      lookupWordOnShortcut:
        typeof candidate.shortcuts?.lookupWordOnShortcut === 'string' &&
        candidate.shortcuts.lookupWordOnShortcut.trim()
          ? candidate.shortcuts.lookupWordOnShortcut.trim()
          : DEFAULT_CONFIG.shortcuts.lookupWordOnShortcut,
      showMainWindow:
        typeof candidate.shortcuts?.showMainWindow === 'string' &&
        candidate.shortcuts.showMainWindow.trim()
          ? candidate.shortcuts.showMainWindow.trim()
          : DEFAULT_CONFIG.shortcuts.showMainWindow,
      ocrDictionary: normalizeConfigString(
        candidate.shortcuts?.ocrDictionary,
        DEFAULT_CONFIG.shortcuts.ocrDictionary,
        64
      ),
      ocrAi: normalizeConfigString(candidate.shortcuts?.ocrAi, DEFAULT_CONFIG.shortcuts.ocrAi, 64)
    },
    selection: {
      dictionaryGroupId: normalizeDictionaryGroupId(candidate.selection?.dictionaryGroupId),
      excludedPrograms: normalizeExcludedPrograms(candidate.selection?.excludedPrograms)
    },
    aiLookup: {
      enabled:
        typeof candidate.aiLookup?.enabled === 'boolean'
          ? candidate.aiLookup.enabled
          : DEFAULT_CONFIG.aiLookup.enabled,
      provider: 'openai-compatible',
      baseUrl: normalizeConfigString(
        candidate.aiLookup?.baseUrl,
        DEFAULT_CONFIG.aiLookup.baseUrl,
        500
      ),
      model: normalizeConfigString(candidate.aiLookup?.model, DEFAULT_CONFIG.aiLookup.model, 200)
    },
    tts: {
      engine: 'system',
      systemVoiceUri:
        typeof candidate.tts?.systemVoiceUri === 'string' &&
        candidate.tts.systemVoiceUri.length <= 500
          ? candidate.tts.systemVoiceUri
          : null
    },
    translation: {
      targetLanguage: TRANSLATION_LANGUAGES.includes(
        candidate.translation?.targetLanguage as TranslationConfig['targetLanguage']
      )
        ? (candidate.translation?.targetLanguage as TranslationConfig['targetLanguage'])
        : DEFAULT_CONFIG.translation.targetLanguage,
      providers: normalizeTranslationProviders(candidate.translation?.providers)
    }
  }
}

function cloneConfig(config: AppConfig): AppConfig {
  return {
    themeMode: config.themeMode,
    aggregateLayout: config.aggregateLayout,
    dictionaryLayout: config.dictionaryLayout,
    dictionaryDisplay: config.dictionaryDisplay,
    featureFlags: { ...config.featureFlags },
    shortcuts: { ...config.shortcuts },
    selection: {
      dictionaryGroupId: config.selection.dictionaryGroupId,
      excludedPrograms: [...config.selection.excludedPrograms]
    },
    aiLookup: {
      ...config.aiLookup
    },
    tts: { ...config.tts },
    translation: {
      targetLanguage: config.translation.targetLanguage,
      providers: config.translation.providers.map((provider) => ({
        ...provider,
        options: { ...provider.options }
      }))
    }
  }
}

function normalizeTranslationProviders(value: unknown): TranslationProviderConfig[] {
  if (!Array.isArray(value)) return cloneConfig(DEFAULT_CONFIG).translation.providers
  const providers: TranslationProviderConfig[] = []
  const seen = new Set<string>()
  let customCount = 0
  const kinds: TranslationProviderKind[] = [
    'system',
    'google',
    'microsoft',
    'volcano',
    'deepl',
    'openai-compatible'
  ]
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const provider = item as Record<string, unknown>
    if (typeof provider.id !== 'string' || !provider.id || provider.id.length > 100) continue
    if (!kinds.includes(provider.kind as TranslationProviderKind)) continue
    if (provider.kind === 'system' && provider.id !== SYSTEM_TRANSLATION_PROVIDER_ID) continue
    if (provider.kind !== 'system' && provider.id === SYSTEM_TRANSLATION_PROVIDER_ID) continue
    if (provider.kind === 'system' && process.platform !== 'darwin') continue
    if (seen.has(provider.id)) continue
    if (provider.kind !== 'system') {
      if (customCount >= 20) continue
      customCount += 1
    }
    seen.add(provider.id)
    const options: Record<string, string> = {}
    const allowedOptions: Record<TranslationProviderKind, string[]> = {
      system: [],
      google: [],
      microsoft: ['region', 'endpoint'],
      volcano: [],
      deepl: ['plan'],
      'openai-compatible': ['baseUrl', 'model']
    }
    if (provider.options && typeof provider.options === 'object') {
      for (const [key, option] of Object.entries(provider.options)) {
        if (
          allowedOptions[provider.kind as TranslationProviderKind].includes(key) &&
          typeof option === 'string' &&
          option.length <= 500
        ) {
          options[key] = option.trim()
        }
      }
    }
    providers.push({
      id: provider.id,
      kind: provider.kind as TranslationProviderKind,
      name:
        provider.kind === 'system'
          ? '系统翻译'
          : typeof provider.name === 'string' && provider.name.trim() && provider.name.length <= 100
            ? provider.name.trim()
            : (provider.kind as TranslationProviderKind),
      enabled: provider.enabled === true,
      options: provider.kind === 'system' ? {} : options
    })
  }
  if (process.platform === 'darwin' && !seen.has(SYSTEM_TRANSLATION_PROVIDER_ID)) {
    providers.unshift({
      id: SYSTEM_TRANSLATION_PROVIDER_ID,
      kind: 'system',
      name: '系统翻译',
      enabled: true,
      options: {}
    })
  }
  return providers
}

function normalizeConfigString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : fallback
}

function normalizeExcludedPrograms(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const programs: string[] = []
  for (const valueItem of value) {
    const program = normalizeProgramName(valueItem)
    if (!program) continue
    const key = program.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    programs.push(program)
    if (programs.length >= 200) break
  }
  return programs
}

function normalizeDictionaryGroupId(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return undefined
  return value
}

function normalizeProgramName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const program = value.trim()
  return program && program.length <= 200 ? program : null
}
