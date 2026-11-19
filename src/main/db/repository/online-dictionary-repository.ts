import { asc, eq, sql } from 'drizzle-orm'
import { fillDictionaryUrlTemplate } from '../../../shared/online-dictionary-template'

import type { DictolDatabase } from '../drizzle'
import { onlineDictionary, type OnlineDictionary } from '../schema'

export type OnlineDictionaryInput = {
  name: string
  faviconUrl?: string
  urlTemplate: string
}

export class OnlineDictionaryRepository {
  constructor(private readonly db: DictolDatabase) {}

  async listAll(): Promise<OnlineDictionary[]> {
    return this.db
      .select()
      .from(onlineDictionary)
      .orderBy(asc(onlineDictionary.sortOrder), asc(onlineDictionary.id))
  }

  async create(input: OnlineDictionaryInput): Promise<OnlineDictionary> {
    const values = normalizeOnlineDictionaryInput(input)
    const [created] = await this.db
      .insert(onlineDictionary)
      .values({
        ...values,
        sortOrder: sql<number>`coalesce((select max(${onlineDictionary.sortOrder}) from ${onlineDictionary}), -1) + 1`
      })
      .returning()
    if (!created) throw new Error('创建在线词典失败')
    return created
  }

  async deleteById(id: number): Promise<void> {
    const rows = await this.db
      .delete(onlineDictionary)
      .where(eq(onlineDictionary.id, id))
      .returning({ id: onlineDictionary.id })
    if (rows.length === 0) throw new Error('在线词典不存在')
  }

  async listIds(): Promise<number[]> {
    const rows = await this.db
      .select({ id: onlineDictionary.id })
      .from(onlineDictionary)
      .orderBy(asc(onlineDictionary.sortOrder), asc(onlineDictionary.id))
    return rows.map((row) => row.id)
  }

  async reorder(ids: number[]): Promise<void> {
    const updatedAt = new Date().toISOString()
    this.db.transaction((tx) => {
      for (let index = 0; index < ids.length; index += 1) {
        tx.update(onlineDictionary)
          .set({ sortOrder: index, updatedAt })
          .where(eq(onlineDictionary.id, ids[index]))
          .run()
      }
    })
  }
}

function normalizeOnlineDictionaryInput(input: OnlineDictionaryInput): {
  name: string
  faviconUrl: string
  urlTemplate: string
} {
  if (!input || typeof input !== 'object') throw new Error('在线词典配置无效')

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const urlTemplate = typeof input.urlTemplate === 'string' ? input.urlTemplate.trim() : ''
  const faviconInput = typeof input.faviconUrl === 'string' ? input.faviconUrl.trim() : ''
  if (!name) throw new Error('在线词典名称不能为空')
  if (name.length > 100) throw new Error('在线词典名称不能超过 100 个字符')
  if (urlTemplate.length > 2_000) throw new Error('URL 模板不能超过 2,000 个字符')

  const templateUrl = parseHttpUrl(fillDictionaryUrlTemplate(urlTemplate, 'term'))
  if (!templateUrl) throw new Error('URL 模板必须是有效的 HTTP 或 HTTPS 地址')

  const faviconUrl = faviconInput || `${templateUrl.origin}/favicon.ico`
  if (faviconUrl.length > 2_000) throw new Error('favicon URL 不能超过 2,000 个字符')
  if (!parseHttpUrl(faviconUrl)) throw new Error('favicon URL 必须是有效的 HTTP 或 HTTPS 地址')

  return { name, faviconUrl, urlTemplate }
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
