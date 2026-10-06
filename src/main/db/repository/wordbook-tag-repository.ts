import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import type { DictolDatabase } from '../drizzle'
import { wordbookTag, wordbookWordTag } from '../schema'

export type WordbookTagSummary = {
  id: number
  name: string
  wordCount: number
}

export type WordbookTagItem = {
  id: number
  name: string
}

export class WordbookTagRepository {
  constructor(private readonly db: DictolDatabase) {}

  async listTags(): Promise<WordbookTagSummary[]> {
    return await this.db
      .select({
        id: wordbookTag.id,
        name: wordbookTag.name,
        wordCount: sql<number>`count(${wordbookWordTag.wordbookWordId})`
      })
      .from(wordbookTag)
      .leftJoin(wordbookWordTag, eq(wordbookWordTag.tagId, wordbookTag.id))
      .groupBy(wordbookTag.id)
      .orderBy(asc(wordbookTag.name))
  }

  async createTag(term: string): Promise<WordbookTagItem> {
    const { name, normalizedName } = normalizeWordbookTagName(term)
    if (await this.findByNormalizedName(normalizedName)) throw new Error('标签已存在')

    const [created] = await this.db
      .insert(wordbookTag)
      .values({ name, normalizedName })
      .returning({ id: wordbookTag.id, name: wordbookTag.name })
    if (!created) throw new Error('创建标签失败')
    return created
  }

  async renameTag(id: number, term: string): Promise<void> {
    const { name, normalizedName } = normalizeWordbookTagName(term)
    const existing = await this.findByNormalizedName(normalizedName)
    if (existing && existing.id !== id) throw new Error('标签已存在')

    const [updated] = await this.db
      .update(wordbookTag)
      .set({ name, normalizedName, updatedAt: new Date().toISOString() })
      .where(eq(wordbookTag.id, id))
      .returning({ id: wordbookTag.id })
    if (!updated) throw new Error('标签不存在')
  }

  private async findByNormalizedName(normalizedName: string) {
    return (
      await this.db
        .select()
        .from(wordbookTag)
        .where(eq(wordbookTag.normalizedName, normalizedName))
        .limit(1)
      )[0]
  }

  async deleteTag(id: number): Promise<void> {
    await this.db.delete(wordbookTag).where(eq(wordbookTag.id, id))
  }

  async replaceWordTags(wordId: number, tagIds: number[]): Promise<void> {
    this.db.transaction((tx) => {
      tx.delete(wordbookWordTag).where(eq(wordbookWordTag.wordbookWordId, wordId)).run()
      if (tagIds.length > 0) {
        tx.insert(wordbookWordTag)
          .values(tagIds.map((tagId) => ({ wordbookWordId: wordId, tagId })))
          .run()
      }
    })
  }

  async addTagToWords(wordIds: number[], tagId: number): Promise<void> {
    if (wordIds.length === 0) return
    await this.db
      .insert(wordbookWordTag)
      .values(wordIds.map((wordbookWordId) => ({ wordbookWordId, tagId })))
      .onConflictDoNothing()
  }

  async removeTagFromWords(wordIds: number[], tagId: number): Promise<void> {
    if (wordIds.length === 0) return
    await this.db
      .delete(wordbookWordTag)
      .where(
        and(inArray(wordbookWordTag.wordbookWordId, wordIds), eq(wordbookWordTag.tagId, tagId))
      )
  }
}

function normalizeWordbookTagName(term: string): { name: string; normalizedName: string } {
  if (typeof term !== 'string') throw new Error('无效的标签名称')
  const name = term.trim()
  if (!name) throw new Error('标签名称不能为空')
  if (name.length > 50) throw new Error('标签名称不能超过 50 个字符')
  return { name, normalizedName: name.toLocaleLowerCase() }
}
