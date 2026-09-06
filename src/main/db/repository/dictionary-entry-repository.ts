import { and, asc, count, eq, exists, gte, inArray, lt, sql } from 'drizzle-orm'
import { DictolDatabase } from '../drizzle'
import { dictionary, dictionaryEntry } from '../schema'
import type { NewDictionaryEntry } from '../schema'

export type { DictionaryEntry } from '../schema'

/** search 方法的返回结构 */
export type EntrySearchResult = {
  normalizedWord: string
  word: string
  dictionaryCount: number
}

/** lookupByNormalizedWords 返回的单行 */
export type EntryLookupRow = {
  normalizedWord: string
  word: string
  entryId: number
  dictionaryId: number
  dictionaryName: string
  dictionaryPath: string | null
  dictionaryFileId: number
}

/** findEntryContent 返回的条目内容 */
export type EntryContent = {
  id: number
  word: string
  normalizedWord: string
  dictionaryId: number
  dictionaryName: string
  recordStartOffset: number
  recordEndOffset: number
}

export class DictionaryEntryRepository {
  private db: DictolDatabase

  constructor(db: DictolDatabase) {
    this.db = db
  }

  /** 使用一条批量 INSERT 写入一批词条。 */
  async insertBatch(entries: NewDictionaryEntry[]): Promise<void> {
    if (entries.length === 0) return
    await this.db.insert(dictionaryEntry).values(entries)
  }

  /** 前缀搜索词条：在 ready 词典中查 normalizedWord 前缀匹配，排除含 @/#/_ 的条目 */
  async searchByPrefix(prefix: string, limit = 50): Promise<EntrySearchResult[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
    const upperBound = `${prefix}\u{10ffff}`
    const belongsToReadyDictionary = this.db
      .select({ id: dictionary.id })
      .from(dictionary)
      .where(and(eq(dictionary.id, dictionaryEntry.dictionaryId), eq(dictionary.status, 'ready')))

    const rows = await this.db
      .select({
        normalizedWord: dictionaryEntry.normalizedWord,
        word: sql<string>`min(${dictionaryEntry.word})`.as('word'),
        dictionaryCount: sql<number>`count(distinct ${dictionaryEntry.dictionaryId})`.as(
          'dictionaryCount'
        )
      })
      .from(dictionaryEntry)
      .where(
        and(
          exists(belongsToReadyDictionary),
          gte(dictionaryEntry.normalizedWord, prefix),
          lt(dictionaryEntry.normalizedWord, upperBound),
          sql`instr(${dictionaryEntry.word}, '@') = 0`,
          sql`instr(${dictionaryEntry.word}, '#') = 0`,
          sql`instr(${dictionaryEntry.word}, '_') = 0`
        )
      )
      .groupBy(dictionaryEntry.normalizedWord)
      .orderBy(asc(dictionaryEntry.normalizedWord))
      .limit(safeLimit)

    return rows
  }

  /** 按 normalizedWord 列表批量查出各词典中的匹配 */
  async lookupByNormalizedWords(normalizedWords: string[]): Promise<EntryLookupRow[]> {
    if (normalizedWords.length === 0) return []

    return this.db
      .select({
        normalizedWord: dictionaryEntry.normalizedWord,
        word: sql<string>`min(${dictionaryEntry.word})`.as('word'),
        entryId: sql<number>`min(${dictionaryEntry.id})`.as('entryId'),
        dictionaryId: dictionary.id,
        dictionaryName: dictionary.name,
        dictionaryPath: dictionary.dictPath,
        dictionaryFileId: dictionaryEntry.dictionaryFileId
      })
      .from(dictionaryEntry)
      .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
      .where(
        and(
          eq(dictionary.status, 'ready'),
          inArray(dictionaryEntry.normalizedWord, normalizedWords)
        )
      )
      .groupBy(
        dictionaryEntry.normalizedWord,
        dictionary.id,
        dictionary.name,
        dictionary.dictPath,
        dictionaryEntry.dictionaryFileId
      )
      .orderBy(asc(dictionaryEntry.normalizedWord), asc(dictionary.sortOrder), asc(dictionary.id))
  }

  /** 根据 entryId 查询词条及正文偏移量。 */
  async findEntryContent(entryId: number): Promise<EntryContent | undefined> {
    const [row] = await this.db
      .select({
        id: dictionaryEntry.id,
        word: dictionaryEntry.word,
        normalizedWord: dictionaryEntry.normalizedWord,
        dictionaryId: dictionaryEntry.dictionaryId,
        dictionaryName: dictionary.name,
        recordStartOffset: dictionaryEntry.recordStartOffset,
        recordEndOffset: dictionaryEntry.recordEndOffset
      })
      .from(dictionaryEntry)
      .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
      .where(and(eq(dictionaryEntry.id, entryId), eq(dictionary.status, 'ready')))
      .limit(1)

    return row
  }

  /**
   * 根据一个展示入口找出同一词典中比较值相同的所有 record。
   *
   * MDX 可以把一个词条拆成多个同名 key；返回值按逻辑 record 地址排序，
   * 以便调用方按文件顺序拼接为一个展示文档。
   */
  async findEntryContentsForDisplay(entryId: number): Promise<EntryContent[]> {
    const entry = await this.findEntryContent(entryId)
    if (!entry) return []

    return this.db
      .select({
        id: dictionaryEntry.id,
        word: dictionaryEntry.word,
        normalizedWord: dictionaryEntry.normalizedWord,
        dictionaryId: dictionaryEntry.dictionaryId,
        dictionaryName: dictionary.name,
        recordStartOffset: dictionaryEntry.recordStartOffset,
        recordEndOffset: dictionaryEntry.recordEndOffset
      })
      .from(dictionaryEntry)
      .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
      .where(
        and(
          eq(dictionaryEntry.dictionaryId, entry.dictionaryId),
          eq(dictionaryEntry.normalizedWord, entry.normalizedWord),
          eq(dictionary.status, 'ready')
        )
      )
      .orderBy(asc(dictionaryEntry.recordStartOffset), asc(dictionaryEntry.id))
  }

  /** 根据 entryId 查出所属词典 ID（需 ready） */
  async findDictionaryIdByEntryId(entryId: number): Promise<number | undefined> {
    const [row] = await this.db
      .select({ dictionaryId: dictionaryEntry.dictionaryId })
      .from(dictionaryEntry)
      .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
      .where(and(eq(dictionaryEntry.id, entryId), eq(dictionary.status, 'ready')))
      .limit(1)

    return row?.dictionaryId
  }

  /** 统计某个词典下的词条总数 */
  async countByDictionaryId(dictionaryId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(dictionaryEntry)
      .where(eq(dictionaryEntry.dictionaryId, dictionaryId))

    return row?.total ?? 0
  }

  /** 删除某个词典下的所有词条 */
  async deleteByDictionaryId(dictionaryId: number): Promise<void> {
    await this.db.delete(dictionaryEntry).where(eq(dictionaryEntry.dictionaryId, dictionaryId))
  }
}
