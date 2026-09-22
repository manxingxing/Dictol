import { app } from 'electron'
import type { DidxIndex } from '@dictol/mdict-native'
import { randomUUID } from 'node:crypto'
import { copyFile, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay, setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { asc, eq, inArray } from 'drizzle-orm'

import type {
  DictionaryImportSourceFile,
  DictionaryImportWorkerFile,
  DictionaryImportWorkerRequest
} from '../shared/dictionary-import'
import type { BuiltInLexiconEntry } from './built-in-lexicon-service'
import { DidxQueryService } from './didx-query-service'
import type { DictolDatabase } from './db/drizzle'
import { getDatabasePath, getDictionaryIndexRoot } from './db/paths'
import { DictionaryFileRepository } from './db/repository/dictionary-file-repository'
import { DictionaryRepository } from './db/repository/dictionary-repository'
import {
  DictionaryGroupRepository,
  type DictionaryGroupWithMembers,
  type SearchDictionaryGroup
} from './db/repository/dictionary-group-repository'
import { dictionary, dictionaryEntry, dictionaryIndex, type Dictionary } from './db/schema'
import {
  resolveDictionaryImportFolder,
  selectDictionaryImportPlans
} from './dictionary-import-files'
import { QueryHistoryRepository } from './db/repository/query-history-repository'
import {
  OnlineDictionaryRepository,
  type OnlineDictionaryInput
} from './db/repository/online-dictionary-repository'
import {
  WordbookRepository,
  type WordbookImportItem,
  type WordbookWordWithWordbook
} from './db/repository/wordbook-repository'
import { createDictionaryAssetUrl } from './dictionary-entry-url'

export type DictionaryStatus = 'pending' | 'importing' | 'ready' | 'error'

const WINDOWS_RENAME_RETRY_LIMIT = 10
const WINDOWS_RENAME_RETRY_DELAY_MS = 25

export type DictionarySummary = {
  id: string
  name: string
  description: string | null
  customCss: string
  iconUrl: string | null
  dictPath: string | null
  recordCount: string | null
  status: DictionaryStatus
  external: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type DictionaryIndexInfo = {
  dictionaryId: string
  indexPath: string
  status: 'building' | 'ready' | 'error' | 'needs_reindex' | 'missing'
  entryCount: number | null
  termCount: number | null
  fileSize: number | null
  builtAt: string | null
}

export type ReadyDictionary = {
  id: string
  name: string
  description: string | null
  recordCount: string | null
  status: 'ready'
  indexStatus: 'building' | 'ready' | 'error' | 'needs_reindex' | 'missing'
  createdAt: string
  updatedAt: string
}

export type ImportedDictionary = {
  id: string
  name: string
  status: 'importing'
  directory: string
  files: Array<{
    id: string
    name: string
    type: 'mdx' | 'mdd'
  }>
}

type DictionaryImportWorkerMessage =
  { type: 'ready'; name: string; indexElapsedMs: number } | { type: 'error'; error: string }

type QueuedDictionaryImport = {
  request: DictionaryImportWorkerRequest
  onReady?: (name: string, indexElapsedMs: number) => void
}

const IMPORT_WORKER_CONCURRENCY = 2

export type DictionaryMatch = {
  dictionaryId: string
  dictionaryName: string
  dictionaryIconUrl: string | null
}

export type DictionaryEntryGroup = {
  word: string
  normalizedWord: string
  dictionaries: DictionaryMatch[]
}

export type DictionaryEntryMatch = {
  word: string
  normalizedWord: string
}

export type DictionarySearchResult = {
  word: string
  normalizedWord: string
  dictionaryIds: string[]
}

export type DictionarySearchGroup = {
  id: string
  name: string
  dictionaryCount: number
}

export type DictionaryGroupSummary = {
  id: string
  name: string
  sortOrder: number
  dictionaryIds: string[]
}

export type DictionaryIndexProvider = {
  acquireMany(
    dictionaryIds: readonly number[]
  ): Promise<Array<{ dictionaryId: number; index: DidxIndex }>>
}

export type QueryHistoryItem = {
  id: string
  term: string
  queryCount: number
  lastQueriedAt: string
}

export type WordbookSummary = {
  id: string
  name: string
  isDefault: boolean
  wordCount: number
  createdAt: string
  updatedAt: string
}

export type WordbookWordItem = {
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
}

export type OnlineDictionaryConfig = {
  id: string
  name: string
  faviconUrl: string
  urlTemplate: string
}

export type WordbookWordsPaginated = {
  items: WordbookWordItem[]
  total: number
}

export type WordbookExportRequest =
  | { scope: 'all' }
  | { scope: 'wordbook'; wordbookId: string }
  | { scope: 'selected'; wordIds: string[] }

export type WordbookExportStatus = {
  state: 'idle' | 'exporting' | 'completed' | 'error'
  destinationPath: string | null
  error: string | null
}

export type WordbookImportResult = {
  imported: number
  matched: number
  unmatched: number
  wordbookId: string
  wordbookName: string
}

const MAX_WORDBOOK_IMPORT_WORDS = 5_000

export class DBService {
  private readonly pendingDictionaryImports: QueuedDictionaryImport[] = []
  private activeDictionaryImports = 0
  private readonly dictionaryRepo: DictionaryRepository
  private readonly dictionaryGroupRepo: DictionaryGroupRepository
  private readonly fileRepo: DictionaryFileRepository
  private readonly queryHistoryRepo: QueryHistoryRepository
  private readonly wordbookRepo: WordbookRepository
  private readonly onlineDictionaryRepo: OnlineDictionaryRepository
  private wordbookExportStatus: WordbookExportStatus = {
    state: 'idle',
    destinationPath: null,
    error: null
  }
  private readonly wordbookExportListeners = new Set<(status: WordbookExportStatus) => void>()

  constructor(
    private readonly db: DictolDatabase,
    private readonly lexicon: { lookup(word: string): BuiltInLexiconEntry | null } | undefined,
    private readonly dictionaryIndexProvider: DictionaryIndexProvider
  ) {
    this.dictionaryRepo = new DictionaryRepository(db)
    this.dictionaryGroupRepo = new DictionaryGroupRepository(db)
    this.fileRepo = new DictionaryFileRepository(db)
    this.queryHistoryRepo = new QueryHistoryRepository(db)
    this.wordbookRepo = new WordbookRepository(db)
    this.onlineDictionaryRepo = new OnlineDictionaryRepository(db)
  }

  async listWordbooks(): Promise<WordbookSummary[]> {
    const rows = await this.wordbookRepo.listAll()
    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      isDefault: row.isDefault,
      wordCount: row.wordCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }))
  }

  async createWordbook(name: string): Promise<WordbookSummary> {
    if (typeof name !== 'string') throw new Error('无效的生词本名称')
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('生词本名称不能为空')
    if (normalizedName.length > 100) throw new Error('生词本名称不能超过 100 个字符')

    const created = await this.wordbookRepo.create(normalizedName)
    return {
      id: String(created.id),
      name: created.name,
      isDefault: created.isDefault,
      wordCount: 0,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    }
  }

  async listWordbookWordsPaginated(
    wordbookId?: string,
    page = 1,
    pageSize = 25
  ): Promise<WordbookWordsPaginated> {
    const numericWordbookId =
      wordbookId === undefined ? undefined : this.parseWordbookId(wordbookId)
    const { items, total } = await this.wordbookRepo.listWordsPaginated(
      numericWordbookId,
      page,
      pageSize
    )
    return {
      items: items.map(toWordbookWordItem),
      total
    }
  }

  async filterWordbookWords(
    keyword: string,
    wordbookId?: string,
    page = 1,
    pageSize = 25
  ): Promise<WordbookWordsPaginated> {
    if (typeof keyword !== 'string') throw new Error('无效的关键词')
    const trimmed = keyword.trim()
    if (!trimmed) throw new Error('关键词不能为空')

    const numericWordbookId =
      wordbookId === undefined ? undefined : this.parseWordbookId(wordbookId)

    const { items, total } = await this.wordbookRepo.filterWords(
      trimmed,
      numericWordbookId,
      page,
      pageSize
    )
    return {
      items: items.map(toWordbookWordItem),
      total
    }
  }

  async deleteWordbook(wordbookId: string): Promise<void> {
    const numericId = this.parseWordbookId(wordbookId)
    const book = await this.wordbookRepo.findById(numericId)
    if (!book) throw new Error('生词本不存在')
    if (book.isDefault) throw new Error('默认生词本不能删除')
    await this.wordbookRepo.deleteById(numericId)
  }

  async renameWordbook(wordbookId: string, name: string): Promise<void> {
    const numericId = this.parseWordbookId(wordbookId)
    await this.wordbookRepo.rename(numericId, name)
  }

  async addWordToDefaultWordbook(word: string, star = 0): Promise<WordbookWordItem> {
    if (typeof word !== 'string') throw new Error('无效的单词')
    const normalizedWord = word.trim().toLocaleLowerCase()
    if (!normalizedWord) throw new Error('单词不能为空')
    if (normalizedWord.length > 300) throw new Error('单词不能超过 300 个字符')
    if (!Number.isInteger(star) || star < 0 || star > 5) throw new Error('星级必须在 0 到 5 之间')

    const saved = await this.wordbookRepo.star(word, star, this.lexicon?.lookup(word) ?? null)
    const defaultWordbook = await this.wordbookRepo.findDefault()
    if (!defaultWordbook) throw new Error('默认生词本不存在')
    return toWordbookWordItem({ ...saved, wordbookName: defaultWordbook.name, isDefault: true })
  }

  async importWordbookWords(text: string, wordbookId?: string): Promise<WordbookImportResult> {
    const words = parseWordbookImportText(text)
    if (words.length === 0) throw new Error('请至少输入一个单词')
    if (words.length > MAX_WORDBOOK_IMPORT_WORDS) {
      throw new Error(`一次最多导入 ${MAX_WORDBOOK_IMPORT_WORDS} 个单词`)
    }

    const targetWordbook = wordbookId
      ? await this.wordbookRepo.findById(this.parseWordbookId(wordbookId))
      : await this.wordbookRepo.findDefault()
    if (!targetWordbook) throw new Error(wordbookId ? '生词本不存在' : '默认生词本不存在')

    const items: WordbookImportItem[] = words.map((word) => ({
      word,
      lexiconEntry: this.lexicon?.lookup(word) ?? null
    }))
    await this.wordbookRepo.importWords(targetWordbook.id, items)

    const matched = items.filter((item) => item.lexiconEntry !== null).length
    return {
      imported: items.length,
      matched,
      unmatched: items.length - matched,
      wordbookId: String(targetWordbook.id),
      wordbookName: targetWordbook.name
    }
  }

  async toggleStarWord(word: string): Promise<void> {
    if (typeof word !== 'string') throw new Error('无效的单词')
    const normalizedWord = word.trim().toLocaleLowerCase()
    if (!normalizedWord) throw new Error('单词不能为空')
    if (normalizedWord.length > 300) throw new Error('单词不能超过 300 个字符')
    if (await this.wordbookRepo.isStarred(word)) {
      await this.wordbookRepo.unStar(word)
      return
    }
    await this.wordbookRepo.star(word, 3, this.lexicon?.lookup(word) ?? null)
  }

  async unStarWord(word: string): Promise<void> {
    if (typeof word !== 'string') throw new Error('无效的单词')
    const normalizedWord = word.trim().toLocaleLowerCase()
    if (!normalizedWord) throw new Error('单词不能为空')
    await this.wordbookRepo.unStar(word)
  }

  async isWordStarred(word: string): Promise<boolean> {
    if (typeof word !== 'string') throw new Error('无效的单词')
    const normalizedWord = word.trim().toLocaleLowerCase()
    if (!normalizedWord) return false
    return await this.wordbookRepo.isStarred(word)
  }

  async updateWordStar(word: string, star: number): Promise<void> {
    if (typeof word !== 'string') throw new Error('无效的单词')
    const normalizedWord = word.trim().toLocaleLowerCase()
    if (!normalizedWord) throw new Error('单词不能为空')
    if (normalizedWord.length > 300) throw new Error('单词不能超过 300 个字符')
    if (typeof star !== 'number' || !Number.isInteger(star) || star < 0 || star > 5)
      throw new Error('星级必须是 0 到 5 的整数')
    await this.wordbookRepo.updateStar(word, star)
  }

  async moveWordbookWords(wordIds: string[], destinationWordbookId: string): Promise<void> {
    if (!Array.isArray(wordIds) || wordIds.length === 0) throw new Error('请选择至少一个单词')
    const numericWordIds = wordIds.map((id) => this.parseWordbookWordId(id))
    if (new Set(numericWordIds).size !== numericWordIds.length)
      throw new Error('单词列表包含重复项')

    const targetId = this.parseWordbookId(destinationWordbookId)
    if (!(await this.wordbookRepo.findById(targetId))) throw new Error('目标生词本不存在')
    await this.wordbookRepo.moveWords(numericWordIds, targetId)
  }

  getWordbookExportStatus(): WordbookExportStatus {
    return this.wordbookExportStatus
  }

  onWordbookExportStatus(listener: (status: WordbookExportStatus) => void): () => void {
    this.wordbookExportListeners.add(listener)
    return () => this.wordbookExportListeners.delete(listener)
  }

  async startWordbookExport(
    request: WordbookExportRequest,
    destinationDirectory: string
  ): Promise<void> {
    if (this.wordbookExportStatus.state === 'exporting') throw new Error('正在导出生词本')
    const workerRequest = await this.validateWordbookExportRequest(request)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const temporaryPath = join(app.getPath('temp'), `dictol-wordbooks-${randomUUID()}.xlsx`)
    const destinationPath = join(destinationDirectory, `Dictol-生词本-${timestamp}.xlsx`)

    this.setWordbookExportStatus({ state: 'exporting', destinationPath: null, error: null })
    void this.runWordbookExport(workerRequest, temporaryPath, destinationPath)
  }

  async listDictionaries(): Promise<DictionarySummary[]> {
    const rows = await this.dictionaryRepo.listAll()
    const iconUrls = await Promise.all(rows.map((row) => this.createDictionaryIconUrl(row)))

    return rows.map((row, index) => ({
      id: String(row.id),
      name: row.name,
      description: row.description,
      customCss: row.customCss,
      iconUrl: iconUrls[index],
      dictPath: row.dictPath,
      recordCount: row.recordCount?.toString() ?? null,
      status: row.status,
      external: row.external,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }))
  }

  async getDictionaryIndexInfo(dictionaryId: string): Promise<DictionaryIndexInfo> {
    const numericId = this.parseDictionaryId(dictionaryId)
    const [row] = await this.db
      .select({
        id: dictionary.id,
        uuid: dictionary.uuid,
        status: dictionaryIndex.status,
        entryCount: dictionaryIndex.entryCount,
        termCount: dictionaryIndex.termCount,
        fileSize: dictionaryIndex.fileSize,
        builtAt: dictionaryIndex.builtAt
      })
      .from(dictionary)
      .leftJoin(dictionaryIndex, eq(dictionaryIndex.dictionaryId, dictionary.id))
      .where(eq(dictionary.id, numericId))

    if (!row) throw new Error('词典不存在')
    const indexPath = join(getDictionaryIndexRoot(), row.uuid, 'index.didx')
    let status: DictionaryIndexInfo['status'] = row.status ?? 'missing'
    if (status === 'ready') {
      try {
        await stat(indexPath)
      } catch {
        status = 'missing'
      }
    }

    return {
      dictionaryId: String(row.id),
      indexPath,
      status,
      entryCount: row.entryCount,
      termCount: row.termCount,
      fileSize: row.fileSize,
      builtAt: row.builtAt
    }
  }

  async listDictionaryPaths(): Promise<string[]> {
    return (await this.dictionaryRepo.listAll()).flatMap((row) =>
      row.dictPath ? [row.dictPath] : []
    )
  }

  async listOnlineDictionaries(): Promise<OnlineDictionaryConfig[]> {
    const rows = await this.onlineDictionaryRepo.listAll()
    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      faviconUrl: row.faviconUrl,
      urlTemplate: row.urlTemplate
    }))
  }

  async addOnlineDictionary(input: OnlineDictionaryInput): Promise<OnlineDictionaryConfig> {
    const created = await this.onlineDictionaryRepo.create(input)
    return {
      id: String(created.id),
      name: created.name,
      faviconUrl: created.faviconUrl,
      urlTemplate: created.urlTemplate
    }
  }

  async deleteOnlineDictionary(id: string): Promise<void> {
    const numericId = this.parseOnlineDictionaryId(id)
    await this.onlineDictionaryRepo.deleteById(numericId)
  }

  async reorderOnlineDictionaries(ids: string[]): Promise<void> {
    if (!Array.isArray(ids)) throw new Error('无效的在线词典顺序')

    const requestedIds = ids.map(Number)
    if (
      requestedIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(requestedIds).size !== requestedIds.length
    ) {
      throw new Error('在线词典顺序包含无效或重复的 ID')
    }

    const currentIds = await this.onlineDictionaryRepo.listIds()
    const currentSet = new Set(currentIds)
    if (requestedIds.some((id) => !currentSet.has(id))) throw new Error('在线词典不存在')

    const requestedSet = new Set(requestedIds)
    const completeOrder = [...requestedIds, ...currentIds.filter((id) => !requestedSet.has(id))]
    await this.onlineDictionaryRepo.reorder(completeOrder)
  }

  async listReadyDictionaries(): Promise<ReadyDictionary[]> {
    const rows = await this.listReadyDictionaryRowsWithIndexStatus()

    return rows.map((row) => ({
      id: String(row.dictionary.id),
      name: row.dictionary.name,
      description: row.dictionary.description,
      recordCount: row.dictionary.recordCount?.toString() ?? null,
      status: 'ready',
      indexStatus: row.indexStatus ?? 'missing',
      createdAt: row.dictionary.createdAt,
      updatedAt: row.dictionary.updatedAt
    }))
  }

  async deleteLegacyDictionaryEntries(dictionaryId: number): Promise<void> {
    const startedAt = performance.now()
    let deletedRows = 0
    let maximumBatchMs = 0
    try {
      while (true) {
        const batchStartedAt = performance.now()
        const result = this.db
          .delete(dictionaryEntry)
          .where(
            inArray(
              dictionaryEntry.id,
              this.db
                .select({ id: dictionaryEntry.id })
                .from(dictionaryEntry)
                .where(eq(dictionaryEntry.dictionaryId, dictionaryId))
                .limit(2000)
            )
          )
          .run()
        deletedRows += result.changes
        maximumBatchMs = Math.max(maximumBatchMs, performance.now() - batchStartedAt)
        if (result.changes < 2000) break
        await yieldToEventLoop()
      }
    } finally {
      console.info('[DIDX] legacy cleanup', {
        dictionaryId,
        deletedRows,
        cleanupElapsedMs: Number((performance.now() - startedAt).toFixed(2)),
        maximumBatchMs: Number(maximumBatchMs.toFixed(2))
      })
    }
  }

  async recordQueryHistory(term: string): Promise<void> {
    const normalizedTerm = term.trim().toLowerCase()
    if (!normalizedTerm || normalizedTerm.length > 200) return

    await this.queryHistoryRepo.upsert(term.trim(), normalizedTerm)
    await this.queryHistoryRepo.trimTo(200)
  }

  async listQueryHistory(): Promise<QueryHistoryItem[]> {
    const rows = await this.queryHistoryRepo.listRecent(200)

    return rows.map((row) => ({
      id: String(row.id),
      term: row.term,
      queryCount: row.queryCount,
      lastQueriedAt: row.lastQueriedAt
    }))
  }

  async clearQueryHistory(): Promise<void> {
    await this.queryHistoryRepo.clear()
  }

  async deleteDictionary(dictionaryId: string): Promise<void> {
    const numericId = Number(dictionaryId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new Error('无效的词典 ID')

    const row = await this.dictionaryRepo.findById(numericId)
    if (!row) throw new Error('词典不存在')
    if (row.status === 'importing') throw new Error('词典正在导入，暂时无法删除')

    const dictionariesRoot = resolve(app.getPath('userData'), 'dictionaries')
    const dictionaryDirectory = row.external || !row.dictPath ? null : resolve(row.dictPath)
    if (dictionaryDirectory && dirname(dictionaryDirectory) !== dictionariesRoot) {
      throw new Error('词典目录不在允许删除的位置')
    }

    const stagedDirectory = dictionaryDirectory
      ? join(dictionariesRoot, `.deleting-${basename(dictionaryDirectory)}-${randomUUID()}`)
      : null
    let directoryWasStaged = false

    if (dictionaryDirectory && stagedDirectory) {
      try {
        await renameDictionaryDirectory(dictionaryDirectory, stagedDirectory)
        directoryWasStaged = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }

    try {
      await this.dictionaryRepo.deleteById(numericId)
    } catch (error) {
      if (directoryWasStaged && dictionaryDirectory && stagedDirectory) {
        try {
          await renameDictionaryDirectory(stagedDirectory, dictionaryDirectory)
        } catch (restoreError) {
          console.error('Failed to restore dictionary directory after database deletion failed', {
            dictionaryId,
            restoreError
          })
        }
      }
      throw error
    }

    if (directoryWasStaged && stagedDirectory) {
      await rm(stagedDirectory, { recursive: true, force: true })
    }
    await rm(join(getDictionaryIndexRoot(), row.uuid), { recursive: true, force: true })
  }

  async getDictionaryPath(dictionaryId: string): Promise<string | null> {
    const row = await this.dictionaryRepo.findById(this.parseDictionaryId(dictionaryId))
    return row?.dictPath ?? null
  }

  async getDictionary(dictionaryId: string): Promise<Dictionary | undefined> {
    return this.dictionaryRepo.findById(this.parseDictionaryId(dictionaryId))
  }

  async getDictionaryIconResource(
    dictionaryId: string,
    resourcePath: string
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    const dictPath = await this.getDictionaryPath(dictionaryId)

    if (!dictPath) {
      return null
    }

    const dictionaryDirectory = resolve(dictPath)
    const requestedPath = resolve(dictionaryDirectory, ...resourcePath.split('/'))

    try {
      const bytes = await readFile(requestedPath)
      return {
        bytes,
        mimeType: getImageMimeType(requestedPath)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async updateDictionaryName(dictionaryId: string, name: string): Promise<void> {
    const numericId = this.parseDictionaryId(dictionaryId)
    if (typeof name !== 'string') throw new Error('无效的词典名称')
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('词典名称不能为空')
    if (normalizedName.length > 100) throw new Error('词典名称不能超过 100 个字符')

    if (!(await this.dictionaryRepo.updateName(numericId, normalizedName))) {
      throw new Error('词典不存在')
    }
  }

  async updateDictionaryCustomCss(dictionaryId: string, customCss: string): Promise<void> {
    const numericId = this.parseDictionaryId(dictionaryId)
    if (typeof customCss !== 'string') throw new Error('无效的自定义 CSS')
    if (customCss.length > 200_000) throw new Error('自定义 CSS 不能超过 200,000 个字符')

    if (!(await this.dictionaryRepo.updateCustomCss(numericId, customCss))) {
      throw new Error('词典不存在')
    }
  }

  async reorderDictionaries(dictionaryIds: string[]): Promise<void> {
    if (!Array.isArray(dictionaryIds)) throw new Error('无效的词典顺序')

    const requestedIds = dictionaryIds.map(Number)
    if (
      requestedIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(requestedIds).size !== requestedIds.length
    ) {
      throw new Error('词典顺序包含无效或重复的 ID')
    }

    const currentIds = await this.dictionaryRepo.listIds()
    const currentSet = new Set(currentIds)
    if (requestedIds.some((id) => !currentSet.has(id))) throw new Error('词典不存在')

    const requestedSet = new Set(requestedIds)
    const completeOrder = [...requestedIds, ...currentIds.filter((id) => !requestedSet.has(id))]
    await this.dictionaryRepo.reorder(completeOrder)
  }

  async updateDictionaryEnabled(dictionaryId: string, enabled: boolean): Promise<void> {
    const numericId = this.parseDictionaryId(dictionaryId)
    if (typeof enabled !== 'boolean') throw new Error('无效的词典启用状态')
    const updated = await this.dictionaryRepo.updateEnabled(numericId, enabled)
    if (!updated) throw new Error('词典不存在')
  }

  private async listReadyDictionaryIndexes(
    groupId?: number
  ): Promise<Array<{ dictionaryId: number; index: DidxIndex }>> {
    const dictionaries = await this.listSearchableDictionaries()
    if (groupId === undefined) {
      return this.dictionaryIndexProvider.acquireMany(dictionaries.map(({ id }) => id))
    }
    const memberIds = await this.dictionaryGroupRepo.listSearchableMemberIds(groupId)
    const dictionariesById = new Map(dictionaries.map((dictionary) => [dictionary.id, dictionary]))
    return this.dictionaryIndexProvider.acquireMany(
      memberIds
        .map((id) => dictionariesById.get(id))
        .filter((dictionary) => dictionary !== undefined)
        .map(({ id }) => id)
    )
  }

  async importDictionaryFromFile(
    mdxPath: string,
    sourceFiles: DictionaryImportSourceFile[],
    copyFiles = true,
    onReady?: (name: string, indexElapsedMs: number) => void
  ): Promise<ImportedDictionary> {
    const { imported, workerRequest } = await this.prepareDictionaryImport(mdxPath, sourceFiles, copyFiles)
    this.enqueueDictionaryImport({ request: workerRequest, onReady })
    return imported
  }

  async importDictionariesFromFolder(
    rootPath: string,
    copyFiles: boolean,
    onReady?: (name: string, indexElapsedMs: number) => void,
    selectedMdxPaths: readonly string[] = []
  ): Promise<ImportedDictionary[]> {
    const existingDictionaryPaths = await this.listDictionaryPaths()
    const plans = await resolveDictionaryImportFolder(rootPath, existingDictionaryPaths)
    if (plans.length === 0) throw new Error('所选目录及其子目录中没有找到 MDX 文件')
    const selectedPlans = selectDictionaryImportPlans(plans, selectedMdxPaths)
    if (selectedPlans.length === 0) throw new Error('请至少选择一部词典')

    const prepared: Array<{
      imported: ImportedDictionary
      workerRequest: DictionaryImportWorkerRequest
    }> = []
    try {
      for (const plan of selectedPlans) {
        prepared.push(await this.prepareDictionaryImport(plan.mdxPath, plan.sourceFiles, copyFiles))
      }
    } catch (error) {
      await Promise.all(
        prepared.map(({ imported }) => this.dictionaryRepo.deleteById(Number(imported.id)))
      )
      throw error
    }

    for (const item of prepared) {
      this.enqueueDictionaryImport({ request: item.workerRequest, onReady })
    }
    return prepared.map(({ imported }) => imported)
  }

  private async prepareDictionaryImport(
    mdxPath: string,
    sourceFiles: DictionaryImportSourceFile[],
    copyFiles: boolean
  ): Promise<{
    imported: ImportedDictionary
    workerRequest: DictionaryImportWorkerRequest
  }> {
    const normalizedMdxPath = resolve(mdxPath)
    const normalizedFiles = sourceFiles.map((file) => ({
      sourcePath: resolve(file.sourcePath),
      relativePath: file.relativePath
    }))
    const mdxFile = normalizedFiles.find(
      (file) =>
        file.sourcePath === normalizedMdxPath && extname(file.relativePath).toLowerCase() === '.mdx'
    )
    if (!mdxFile) throw new Error(`未找到 MDX 文件：${mdxPath}`)
    if (new Set(normalizedFiles.map((file) => file.relativePath)).size !== normalizedFiles.length) {
      throw new Error('导入文件列表包含重复路径')
    }
    if (normalizedFiles.some((file) => !isSafeImportRelativePath(file.relativePath))) {
      throw new Error('导入文件路径无效')
    }

    const dictionaryUuid = randomUUID()
    const targetDirectory = copyFiles
      ? join(app.getPath('userData'), 'dictionaries', dictionaryUuid)
      : dirname(normalizedMdxPath)
    const dictionaryName = basename(normalizedMdxPath, extname(normalizedMdxPath))
    const dictionaryId = await this.dictionaryRepo.createImporting(
      dictionaryName,
      targetDirectory,
      !copyFiles,
      dictionaryUuid
    )

    try {
      const workerFiles: DictionaryImportWorkerFile[] = []
      for (const file of normalizedFiles) {
        const fileType = getImportFileType(file.relativePath)
        const targetPath = copyFiles ? join(targetDirectory, file.relativePath) : file.sourcePath
        let fileId: number | null = null
        if (fileType) {
          const sourceStats = await stat(file.sourcePath, { bigint: true })
          fileId = await this.fileRepo.create({
            dictionaryId,
            fileName: basename(file.relativePath),
            filePath: targetPath,
            fileType,
            fileSize: toSafeNumber(sourceStats.size, 'file size'),
            lastModified: toSafeNumber(sourceStats.mtimeMs, 'last modified'),
            checksum: null
          })
        }
        workerFiles.push({ ...file, id: fileId })
      }

      const indexPath = join(getDictionaryIndexRoot(), dictionaryUuid, 'index.didx')
      await this.db.insert(dictionaryIndex).values({
        dictionaryId,
        formatVersion: 0,
        normalizationVersion: 0,
        comparisonVersion: 1,
        sourceFingerprint: null,
        status: 'building'
      })

      return {
        imported: {
          id: String(dictionaryId),
          name: dictionaryName,
          status: 'importing',
          directory: targetDirectory,
          files: workerFiles
            .filter((file): file is DictionaryImportWorkerFile & { id: number } => file.id !== null)
            .map((file) => ({
              id: String(file.id),
              name: basename(file.relativePath),
              type: getImportFileType(file.relativePath)!
            }))
        },
        workerRequest: {
          databasePath: getDatabasePath(),
          dictionaryId,
          dictionaryUuid,
          mdxPath: mdxFile.sourcePath,
          sourceFiles: workerFiles,
          copyFiles,
          targetDirectory,
          indexPath
        }
      }
    } catch (error) {
      await this.dictionaryRepo.deleteById(dictionaryId)
      throw error
    }
  }

  private enqueueDictionaryImport(item: QueuedDictionaryImport): void {
    this.pendingDictionaryImports.push(item)
    this.drainDictionaryImports()
  }

  private drainDictionaryImports(): void {
    while (
      this.activeDictionaryImports < IMPORT_WORKER_CONCURRENCY &&
      this.pendingDictionaryImports.length > 0
    ) {
      const item = this.pendingDictionaryImports.shift()!
      this.activeDictionaryImports += 1
      void this.runDictionaryImportWorker(item)
        .catch((error) => {
          console.error('Dictionary import Worker failed', error)
        })
        .finally(() => {
          this.activeDictionaryImports -= 1
          this.drainDictionaryImports()
        })
    }
  }

  private runDictionaryImportWorker(item: QueuedDictionaryImport): Promise<void> {
    const workerPath =
      process.env.DICTOL_IMPORT_WORKER_PATH ?? join(__dirname, 'dictionary-import-worker.js')
    const worker = new Worker(workerPath, { workerData: item.request })

    return new Promise<void>((resolvePromise, rejectPromise) => {
      let workerMessageError: Error | undefined
      worker.on('message', (message: DictionaryImportWorkerMessage) => {
        if (message.type === 'ready') item.onReady?.(message.name, message.indexElapsedMs)
        if (message.type === 'error')
          workerMessageError = new Error(message.error || '词典导入失败')
      })
      worker.once('error', rejectPromise)
      worker.once('exit', (code) => {
        if (workerMessageError) {
          rejectPromise(workerMessageError)
        } else if (code !== 0) {
          rejectPromise(new Error(`词典导入 Worker 异常退出（${code}）`))
        } else {
          resolvePromise()
        }
      })
    })
  }

  async listDictionarySearchGroups(): Promise<DictionarySearchGroup[]> {
    const groups: SearchDictionaryGroup[] = await this.dictionaryGroupRepo.listSearchable()
    return groups.map((group) => ({ ...group, id: String(group.id) }))
  }

  async listDictionaryGroups(): Promise<DictionaryGroupSummary[]> {
    const groups: DictionaryGroupWithMembers[] = await this.dictionaryGroupRepo.listAll()
    return groups.map((group) => this.toDictionaryGroupSummary(group))
  }

  async createDictionaryGroup(name: string): Promise<DictionaryGroupSummary> {
    const normalizedName = this.normalizeDictionaryGroupName(name)
    const created = await this.dictionaryGroupRepo.create(normalizedName)
    return this.toDictionaryGroupSummary({ ...created, dictionaryIds: [] })
  }

  async updateDictionaryGroupName(groupId: string, name: string): Promise<void> {
    const numericGroupId = this.parseDictionaryGroupId(groupId)
    const normalizedName = this.normalizeDictionaryGroupName(name)
    if (!(await this.dictionaryGroupRepo.updateName(numericGroupId, normalizedName))) {
      throw new Error('词典组不存在')
    }
  }

  async deleteDictionaryGroup(groupId: string): Promise<void> {
    const numericGroupId = this.parseDictionaryGroupId(groupId)
    if (!(await this.dictionaryGroupRepo.deleteById(numericGroupId))) {
      throw new Error('词典组不存在')
    }
  }

  async updateDictionaryGroupMembers(groupId: string, dictionaryIds: string[]): Promise<void> {
    const numericGroupId = this.parseDictionaryGroupId(groupId)
    if (!Array.isArray(dictionaryIds)) throw new Error('无效的词典组成员')

    const numericDictionaryIds = dictionaryIds.map((dictionaryId) =>
      this.parseDictionaryId(dictionaryId)
    )
    if (new Set(numericDictionaryIds).size !== numericDictionaryIds.length) {
      throw new Error('词典组成员包含重复的词典')
    }
    await this.dictionaryGroupRepo.updateMembers(numericGroupId, numericDictionaryIds)
  }

  async searchDictionaryEntries(
    prefix: string,
    limit = 50,
    groupId?: number
  ): Promise<DictionarySearchResult[]> {
    const query = prefix.trim()
    if (!query) return []

    const dictionaries = await this.listReadyDictionaryIndexes(groupId)
    const service = new DidxQueryService(dictionaries, { getBaseForms: () => [] }, 8)
    return service.candidate(query, limit).then((matches) =>
      matches.map((match) => ({
        word: match.keyText,
        normalizedWord: match.normalizedKey,
        dictionaryIds: match.dictionaryIds.map(String)
      }))
    )
  }

  async lookupDictionaryEntryGroup(
    term: string,
    groupId?: number
  ): Promise<DictionaryEntryGroup | null> {
    const query = term.trim()
    if (!query) return null

    const dictionaries = await this.listSearchableDictionaries()
    const memberIds =
      groupId === undefined
        ? undefined
        : await this.dictionaryGroupRepo.listSearchableMemberIds(groupId)
    const dictionariesById = new Map(dictionaries.map((dictionary) => [dictionary.id, dictionary]))
    const scopedDictionaries =
      memberIds === undefined
        ? dictionaries
        : memberIds
            .map((id) => dictionariesById.get(id))
            .filter((dictionary) => dictionary !== undefined)
    const service = new DidxQueryService(
      await this.dictionaryIndexProvider.acquireMany(scopedDictionaries.map(({ id }) => id)),
      { getBaseForms: () => [] },
      8
    )
    const exact = await service.exact(query)
    if (exact.length === 0) return null

    const hitDictionaryIds = new Set(exact.map(({ dictionaryId }) => dictionaryId))
    const matchedDictionaries = scopedDictionaries.filter(({ id }) => hitDictionaryIds.has(id))
    return {
      word: exact[0].keyText,
      normalizedWord: exact[0].normalizedKey,
      dictionaries: await Promise.all(
        matchedDictionaries.map(async (dictionary) => ({
          dictionaryId: String(dictionary.id),
          dictionaryName: dictionary.name,
          dictionaryIconUrl: await this.createDictionaryIconUrl(dictionary)
        }))
      )
    }
  }

  async lookupDictionaryEntry(
    dictionaryId: string,
    term: string
  ): Promise<DictionaryEntryMatch | null> {
    const numericDictionaryId = this.parseDictionaryId(dictionaryId)
    const query = term.trim()
    if (!query) return null

    const target = await this.dictionaryRepo.findById(numericDictionaryId)
    if (!target || target.status !== 'ready') return null

    const [dictionaryIndex] = await this.dictionaryIndexProvider.acquireMany([numericDictionaryId])
    const [match] = await dictionaryIndex.index.exact(query)
    return match
      ? {
          word: match.keyText,
          normalizedWord: match.normalizedKey
        }
      : null
  }

  private async listReadyDictionaryRowsWithIndexStatus(): Promise<
    Array<{
      dictionary: Dictionary
      indexStatus: 'building' | 'ready' | 'error' | 'needs_reindex' | null
    }>
  > {
    return this.db
      .select({ dictionary, indexStatus: dictionaryIndex.status })
      .from(dictionary)
      .leftJoin(dictionaryIndex, eq(dictionaryIndex.dictionaryId, dictionary.id))
      .where(eq(dictionary.status, 'ready'))
      .orderBy(asc(dictionary.sortOrder), asc(dictionary.id))
  }

  private async listSearchableDictionaries(): Promise<Dictionary[]> {
    const rows = await this.listReadyDictionaryRowsWithIndexStatus()
    if (rows.some(({ indexStatus }) => indexStatus !== 'ready')) {
      throw new Error('词典索引需要升级，请先完成重新索引。')
    }
    return rows
      .map(({ dictionary: readyDictionary }) => readyDictionary)
      .filter(({ enabled }) => enabled)
  }

  async listDictionaryResourceFiles(dictionaryId: number): Promise<
    Array<{
      id: number
      fileName: string
      filePath: string
      fileType: 'mdx' | 'mdd'
      dictPath: string | null
      external: boolean
      fileSize: number | null
      lastModified: number | null
      checksum: string | null
    }>
  > {
    if (!Number.isSafeInteger(dictionaryId) || dictionaryId <= 0) return []
    return this.fileRepo.listResourceFiles(dictionaryId)
  }

  async updateDictionaryFileLastModified(fileId: number, lastModified: number): Promise<void> {
    await this.fileRepo.updateLastModified(fileId, lastModified)
  }

  private parseDictionaryId(dictionaryId: string): number {
    const numericId = Number(dictionaryId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new Error('无效的词典 ID')
    return numericId
  }

  private parseDictionaryGroupId(groupId: string): number {
    const numericId = Number(groupId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new Error('无效的词典组 ID')
    }
    return numericId
  }

  private normalizeDictionaryGroupName(name: string): string {
    if (typeof name !== 'string') throw new Error('无效的词典组名称')
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('词典组名称不能为空')
    if (normalizedName.length > 100) throw new Error('词典组名称不能超过 100 个字符')
    return normalizedName
  }

  private toDictionaryGroupSummary(group: DictionaryGroupWithMembers): DictionaryGroupSummary {
    return {
      id: String(group.id),
      name: group.name,
      sortOrder: group.sortOrder,
      dictionaryIds: group.dictionaryIds.map(String)
    }
  }

  private parseOnlineDictionaryId(id: string): number {
    const numericId = Number(id)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new Error('无效的在线词典 ID')
    }
    return numericId
  }

  private parseWordbookId(wordbookId: string): number {
    const numericId = Number(wordbookId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new Error('无效的生词本 ID')
    return numericId
  }

  private parseWordbookWordId(wordId: string): number {
    const numericId = Number(wordId)
    if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new Error('无效的单词 ID')
    return numericId
  }

  private async validateWordbookExportRequest(
    request: WordbookExportRequest
  ): Promise<
    | { scope: 'all' }
    | { scope: 'wordbook'; wordbookId: number }
    | { scope: 'selected'; wordIds: number[] }
  > {
    if (request.scope === 'all') return request

    if (request.scope === 'wordbook') {
      const wordbookId = this.parseWordbookId(request.wordbookId)
      if (!(await this.wordbookRepo.findById(wordbookId))) throw new Error('生词本不存在')
      return { scope: 'wordbook', wordbookId }
    }

    if (request.scope === 'selected') {
      if (!Array.isArray(request.wordIds) || request.wordIds.length === 0) {
        throw new Error('请选择至少一个单词')
      }
      const wordIds = request.wordIds.map((id) => this.parseWordbookWordId(id))
      if (new Set(wordIds).size !== wordIds.length) throw new Error('单词列表包含重复项')
      const rows = await this.wordbookRepo.listWordsByIds(wordIds)
      if (rows.length !== wordIds.length) throw new Error('部分所选单词不存在')
      return { scope: 'selected', wordIds }
    }

    throw new Error('无效的导出范围')
  }

  private async runWordbookExport(
    request:
      | { scope: 'all' }
      | { scope: 'wordbook'; wordbookId: number }
      | { scope: 'selected'; wordIds: number[] },
    temporaryPath: string,
    destinationPath: string
  ): Promise<void> {
    try {
      const workerPath =
        process.env.DICTOL_WORDBOOK_EXPORT_WORKER_PATH ??
        join(__dirname, 'wordbook-export-worker.js')
      const worker = new Worker(workerPath, {
        workerData: { databasePath: getDatabasePath(), temporaryPath, request }
      })

      await new Promise<void>((resolve, reject) => {
        let settled = false
        worker.once('message', (message: { ok: boolean; error?: string }) => {
          settled = true
          if (message.ok) resolve()
          else reject(new Error(message.error || '导出生词本失败'))
        })
        worker.once('error', (error) => {
          settled = true
          reject(error)
        })
        worker.once('exit', (code) => {
          if (!settled && code !== 0) reject(new Error(`导出 Worker 异常退出（${code}）`))
          else if (!settled) reject(new Error('导出 Worker 未返回结果'))
        })
      })

      try {
        await rename(temporaryPath, destinationPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        await copyFile(temporaryPath, destinationPath)
        await unlink(temporaryPath)
      }
      this.setWordbookExportStatus({ state: 'completed', destinationPath, error: null })
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      this.setWordbookExportStatus({
        state: 'error',
        destinationPath: null,
        error: error instanceof Error ? error.message : '导出生词本失败'
      })
    }
  }

  private setWordbookExportStatus(status: WordbookExportStatus): void {
    this.wordbookExportStatus = status
    this.wordbookExportListeners.forEach((listener) => listener(status))
  }

  private async getDictionaryIconPath(
    dictionaryId: number,
    dictionaryPath: string | null
  ): Promise<string | null> {
    if (!dictionaryPath) return null
    const [mdxFile] = await this.fileRepo.listByDictionaryIdAndType(dictionaryId, 'mdx')
    return mdxFile ? findDictionaryIconPath(dictionaryPath, mdxFile.filePath) : null
  }

  private async createDictionaryIconUrl(row: Dictionary): Promise<string | null> {
    const iconPath = await this.getDictionaryIconPath(row.id, row.dictPath)
    return iconPath ? createDictionaryAssetUrl(row.id, iconPath) : null
  }
}

function parseWordbookImportText(text: string): string[] {
  if (typeof text !== 'string') throw new Error('无效的导入内容')

  const words: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim()
    if (!word) continue
    if (word.length > 300) throw new Error(`单词不能超过 300 个字符：${word.slice(0, 20)}…`)

    const normalizedWord = word.toLocaleLowerCase()
    if (seen.has(normalizedWord)) continue
    seen.add(normalizedWord)
    words.push(word)
  }
  return words
}

function getImportFileType(filePath: string): 'mdx' | 'mdd' | null {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.mdx') return 'mdx'
  if (extension === '.mdd') return 'mdd'
  return null
}

function isSafeImportRelativePath(filePath: string): boolean {
  if (!filePath || isAbsolute(filePath)) return false
  const normalized = filePath.split(sep).join('/')
  return normalized !== '..' && !normalized.startsWith('../')
}

function toSafeNumber(value: number | bigint, field: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} 超出 SQLite/JavaScript 安全整数范围：${value}`)
  }
  return number
}

function getImageMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

async function renameDictionaryDirectory(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const retryableOnWindows = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      if (
        process.platform !== 'win32' ||
        !retryableOnWindows ||
        attempt >= WINDOWS_RENAME_RETRY_LIMIT
      ) {
        throw error
      }
      await delay(WINDOWS_RENAME_RETRY_DELAY_MS * (attempt + 1))
    }
  }
}

function toWordbookWordItem(row: WordbookWordWithWordbook): WordbookWordItem {
  return {
    id: String(row.id),
    wordbookId: String(row.wordbookId),
    wordbookName: row.wordbookName,
    word: row.word,
    star: row.star,
    dictionaryWord: row.dictionaryWord,
    phonetic: row.phonetic,
    definition: row.definition,
    translation: row.translation,
    ecdictVersion: row.ecdictVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

const DICTIONARY_ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

async function findDictionaryIconPath(
  dictionaryPath: string,
  mdxPath: string
): Promise<string | null> {
  try {
    const entries = await readdir(dirname(mdxPath), { withFileTypes: true })
    const mdxBaseName = basename(mdxPath, extname(mdxPath)).toLowerCase()
    const icon = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          basename(entry.name, extname(entry.name)).toLowerCase() === mdxBaseName &&
          DICTIONARY_ICON_EXTENSIONS.includes(extname(entry.name).toLowerCase())
      )
      .sort(
        (left, right) =>
          DICTIONARY_ICON_EXTENSIONS.indexOf(extname(left.name).toLowerCase()) -
          DICTIONARY_ICON_EXTENSIONS.indexOf(extname(right.name).toLowerCase())
      )[0]

    if (!icon) return null
    const relativeIconPath = relative(resolve(dictionaryPath), join(dirname(mdxPath), icon.name))
    if (!relativeIconPath || relativeIconPath === '..' || relativeIconPath.startsWith(`..${sep}`)) {
      return null
    }
    return relativeIconPath.split(sep).join('/')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
