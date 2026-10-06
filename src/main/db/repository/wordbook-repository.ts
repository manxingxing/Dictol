import { and, asc, desc, eq, inArray, like, sql, type SQL } from 'drizzle-orm'

import type { BuiltInLexiconEntry } from '../../built-in-lexicon-service'
import type { DictolDatabase } from '../drizzle'
import type { WordbookTagItem } from './wordbook-tag-repository'
import {
  wordbook,
  wordbookTag,
  wordbookWord,
  wordbookWordTag,
  type NewWordbookWord,
  type Wordbook,
  type WordbookWord
} from '../schema'

export type WordbookWithWordCount = Wordbook & {
  wordCount: number
}

export type WordbookWordWithWordbook = Omit<WordbookWord, 'ecdictVersion'> & {
  wordbookName: string
  isDefault: boolean
  tags: WordbookTagItem[]
}

export type WordbookImportItem = {
  word: string
  lexiconEntry: BuiltInLexiconEntry | null
}

const WORD_IMPORT_BATCH_SIZE = 500

const wordbookWordFields = {
  id: wordbookWord.id,
  wordbookId: wordbookWord.wordbookId,
  word: wordbookWord.word,
  normalizedWord: wordbookWord.normalizedWord,
  star: wordbookWord.star,
  dictionaryWord: wordbookWord.dictionaryWord,
  phonetic: wordbookWord.phonetic,
  definition: wordbookWord.definition,
  translation: wordbookWord.translation,
  createdAt: wordbookWord.createdAt,
  updatedAt: wordbookWord.updatedAt,
  wordbookName: wordbook.name,
  isDefault: wordbook.isDefault
}

export class WordbookRepository {
  constructor(private readonly db: DictolDatabase) {}

  async listAll(): Promise<WordbookWithWordCount[]> {
    const rows = await this.db
      .select({
        id: wordbook.id,
        name: wordbook.name,
        isDefault: wordbook.isDefault,
        createdAt: wordbook.createdAt,
        updatedAt: wordbook.updatedAt,
        wordCount: sql<number>`count(${wordbookWord.id})`
      })
      .from(wordbook)
      .leftJoin(wordbookWord, eq(wordbookWord.wordbookId, wordbook.id))
      .groupBy(wordbook.id)
      .orderBy(desc(wordbook.isDefault), asc(wordbook.id))

    return rows
  }

  async create(name: string): Promise<Wordbook> {
    const [created] = await this.db.insert(wordbook).values({ name }).returning()
    if (!created) throw new Error('创建生词本失败')
    return created
  }

  async findById(id: number): Promise<Wordbook | undefined> {
    return (await this.db.select().from(wordbook).where(eq(wordbook.id, id)).limit(1))[0]
  }

  async findDefault(): Promise<Wordbook | undefined> {
    return (await this.db.select().from(wordbook).where(eq(wordbook.isDefault, true)).limit(1))[0]
  }

  async listWords(wordbookId?: number): Promise<WordbookWordWithWordbook[]> {
    const query = this.db
      .select(wordbookWordFields)
      .from(wordbookWord)
      .innerJoin(wordbook, eq(wordbookWord.wordbookId, wordbook.id))
      .orderBy(desc(wordbookWord.createdAt))

    const rows = wordbookId
      ? await query.where(eq(wordbookWord.wordbookId, wordbookId))
      : await query

    return await this.attachTags(rows)
  }

  async listWordsByIds(ids: number[]): Promise<WordbookWordWithWordbook[]> {
    if (ids.length === 0) return []
    const rows = await this.db
      .select(wordbookWordFields)
      .from(wordbookWord)
      .innerJoin(wordbook, eq(wordbookWord.wordbookId, wordbook.id))
      .where(inArray(wordbookWord.id, ids))

    const orderedRows = rows.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id))
    return await this.attachTags(orderedRows)
  }

  async star(
    word: string,
    star = 0,
    lexiconEntry: BuiltInLexiconEntry | null = null
  ): Promise<WordbookWord> {
    const trimmed = word.trim()
    const normalizedWord = trimmed.toLocaleLowerCase()
    const defaultWordbook = await this.findDefault()
    if (!defaultWordbook) throw new Error('默认生词本不存在')

    const now = new Date().toISOString()
    const lexiconValues = lexiconEntry
      ? {
          dictionaryWord: lexiconEntry.word,
          phonetic: lexiconEntry.phonetic,
          definition: lexiconEntry.definition,
          translation: lexiconEntry.translation,
          ecdictVersion: lexiconEntry.version
        }
      : {}
    const [saved] = await this.db
      .insert(wordbookWord)
      .values({
        wordbookId: defaultWordbook.id,
        word: trimmed,
        normalizedWord,
        star,
        createdAt: now,
        updatedAt: now,
        ...lexiconValues
      })
      .onConflictDoUpdate({
        target: wordbookWord.normalizedWord,
        set: {
          star: star,
          word: trimmed,
          updatedAt: now,
          ...lexiconValues
        }
      })
      .returning()

    if (!saved) throw new Error('添加单词失败')
    return saved
  }

  async importWords(wordbookId: number, items: WordbookImportItem[]): Promise<void> {
    if (items.length === 0) return

    const now = new Date().toISOString()
    const matchedRows: NewWordbookWord[] = []
    const unmatchedRows: NewWordbookWord[] = []

    for (const { word, lexiconEntry } of items) {
      const trimmed = word.trim()
      const row: NewWordbookWord = {
        wordbookId,
        word: trimmed,
        normalizedWord: trimmed.toLocaleLowerCase(),
        star: 3,
        createdAt: now,
        updatedAt: now,
        ...(lexiconEntry
          ? {
              dictionaryWord: lexiconEntry.word,
              phonetic: lexiconEntry.phonetic,
              definition: lexiconEntry.definition,
              translation: lexiconEntry.translation,
              ecdictVersion: lexiconEntry.version
            }
          : {})
      }

      if (lexiconEntry) matchedRows.push(row)
      else unmatchedRows.push(row)
    }

    if (matchedRows.length > 0) {
      for (const rows of splitIntoBatches(matchedRows, WORD_IMPORT_BATCH_SIZE)) {
        await this.db
          .insert(wordbookWord)
          .values(rows)
          .onConflictDoUpdate({
            target: wordbookWord.normalizedWord,
            set: {
              wordbookId,
              word: sql`excluded.word`,
              dictionaryWord: sql`excluded.dictionary_word`,
              phonetic: sql`excluded.phonetic`,
              definition: sql`excluded.definition`,
              translation: sql`excluded.translation`,
              ecdictVersion: sql`excluded.ecdict_version`,
              updatedAt: now
            }
          })
      }
    }

    if (unmatchedRows.length > 0) {
      for (const rows of splitIntoBatches(unmatchedRows, WORD_IMPORT_BATCH_SIZE)) {
        await this.db
          .insert(wordbookWord)
          .values(rows)
          .onConflictDoUpdate({
            target: wordbookWord.normalizedWord,
            set: {
              wordbookId,
              word: sql`excluded.word`,
              updatedAt: now
            }
          })
      }
    }
  }

  async moveWords(ids: number[], destinationWordbookId: number): Promise<void> {
    if (ids.length === 0) return
    await this.db
      .update(wordbookWord)
      .set({ wordbookId: destinationWordbookId, updatedAt: new Date().toISOString() })
      .where(inArray(wordbookWord.id, ids))
  }

  async isStarred(word: string): Promise<boolean> {
    const normalizedWord = word.trim().toLocaleLowerCase()
    const [row] = await this.db
      .select({ id: wordbookWord.id })
      .from(wordbookWord)
      .where(eq(wordbookWord.normalizedWord, normalizedWord))
      .limit(1)
    return row !== undefined
  }

  async unStar(word: string): Promise<void> {
    const normalizedWord = word.trim().toLocaleLowerCase()
    await this.db.delete(wordbookWord).where(eq(wordbookWord.normalizedWord, normalizedWord))
  }

  async toggleStar(word: string): Promise<void> {
    const starred = await this.isStarred(word)
    if (starred) {
      await this.unStar(word)
    } else {
      await this.star(word, 3)
    }
  }

  async deleteById(id: number): Promise<void> {
    // cascade-deletes linked words via FK onDelete
    await this.db.delete(wordbook).where(eq(wordbook.id, id))
  }

  async rename(id: number, name: string): Promise<Wordbook> {
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('生词本名称不能为空')
    if (normalizedName.length > 100) throw new Error('生词本名称不能超过 100 个字符')

    const [updated] = await this.db
      .update(wordbook)
      .set({ name: normalizedName, updatedAt: new Date().toISOString() })
      .where(eq(wordbook.id, id))
      .returning()
    if (!updated) throw new Error('生词本不存在')
    return updated
  }

  async listWordsPaginated(
    wordbookId?: number,
    page = 1,
    pageSize = 25,
    tagId?: number | null,
    keyword = ''
  ): Promise<{ items: WordbookWordWithWordbook[]; total: number }> {
    const safePage = Math.max(1, Math.trunc(page))
    const safeSize = Math.min(100, Math.max(1, Math.trunc(pageSize)))
    const offset = (safePage - 1) * safeSize

    const base = this.db
      .select(wordbookWordFields)
      .from(wordbookWord)
      .innerJoin(wordbook, eq(wordbookWord.wordbookId, wordbook.id))

    const conditions: SQL[] = []
    if (wordbookId !== undefined) conditions.push(eq(wordbookWord.wordbookId, wordbookId))
    if (keyword) conditions.push(like(wordbookWord.word, `%${keyword}%`))
    if (tagId !== undefined) conditions.push(tagFilterCondition(tagId))
    const target = conditions.length > 0 ? base.where(and(...conditions)) : base

    const countQuery = this.db
      .select({ count: sql<number>`count(*)` })
      .from(wordbookWord)
      .innerJoin(wordbook, eq(wordbookWord.wordbookId, wordbook.id))

    const [countRow] =
      conditions.length > 0 ? await countQuery.where(and(...conditions)) : await countQuery

    const rows = await target.orderBy(desc(wordbookWord.createdAt)).limit(safeSize).offset(offset)
    const items = await this.attachTags(rows)

    return { items, total: countRow?.count ?? 0 }
  }

  private async attachTags<T extends { id: number }>(
    rows: T[]
  ): Promise<Array<T & { tags: WordbookTagItem[] }>> {
    if (rows.length === 0) return []
    const links = await this.db
      .select({
        wordbookWordId: wordbookWordTag.wordbookWordId,
        id: wordbookTag.id,
        name: wordbookTag.name
      })
      .from(wordbookWordTag)
      .innerJoin(wordbookTag, eq(wordbookWordTag.tagId, wordbookTag.id))
      .where(
        inArray(
          wordbookWordTag.wordbookWordId,
          rows.map(({ id }) => id)
        )
      )
      .orderBy(asc(wordbookTag.name))
    const tagsByWordId = new Map<number, WordbookTagItem[]>()
    for (const { wordbookWordId, id, name } of links) {
      const tags = tagsByWordId.get(wordbookWordId) ?? []
      tags.push({ id, name })
      tagsByWordId.set(wordbookWordId, tags)
    }
    return rows.map((row) => ({ ...row, tags: tagsByWordId.get(row.id) ?? [] }))
  }

  async updateStar(word: string, star: number): Promise<void> {
    if (star < 0 || star > 5) throw new Error('星级必须在 0 到 5 之间')
    const normalizedWord = word.trim().toLocaleLowerCase()
    await this.db
      .update(wordbookWord)
      .set({ star, updatedAt: new Date().toISOString() })
      .where(eq(wordbookWord.normalizedWord, normalizedWord))
  }
}

function tagFilterCondition(tagId: number | null): SQL {
  return tagId === null
    ? sql`not exists (
        select 1 from ${wordbookWordTag}
        where ${wordbookWordTag.wordbookWordId} = ${wordbookWord.id}
      )`
    : sql`exists (
        select 1 from ${wordbookWordTag}
        where ${wordbookWordTag.wordbookWordId} = ${wordbookWord.id}
          and ${wordbookWordTag.tagId} = ${tagId}
      )`
}

function* splitIntoBatches<T>(items: T[], size: number): Generator<T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size)
  }
}
