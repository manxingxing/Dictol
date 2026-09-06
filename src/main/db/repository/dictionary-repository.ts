import { asc, eq, sql } from 'drizzle-orm'
import { DictolDatabase } from '../drizzle'
import { Dictionary, dictionary } from '../schema'

export class DictionaryRepository {
  private db: DictolDatabase

  constructor(db: DictolDatabase) {
    this.db = db
  }

  /** 创建一条正在导入的词典记录，并追加到当前排序末尾。 */
  async createImporting(name: string, dictPath: string, external = false): Promise<number> {
    const [row] = await this.db
      .insert(dictionary)
      .values({
        name,
        dictPath,
        external,
        status: 'importing',
        sortOrder: sql<number>`coalesce((select max(${dictionary.sortOrder}) from ${dictionary}), -1) + 1`
      })
      .onConflictDoNothing({ target: dictionary.dictPath })
      .returning({ id: dictionary.id })

    if (!row) {
      throw new Error('此目录已被其他词典使用，无法重复导入。请先删除已有词典，或选择其他目录。')
    }
    return row.id
  }

  /** 将导入完成的词典标记为可用。 */
  async markReady(
    id: number,
    values: { name: string; description: string | null; recordCount: number }
  ): Promise<void> {
    await this.db
      .update(dictionary)
      .set({
        ...values,
        status: 'ready',
        updatedAt: new Date().toISOString()
      })
      .where(eq(dictionary.id, id))
  }

  /** 标记导入失败。 */
  async markError(id: number): Promise<void> {
    await this.db
      .update(dictionary)
      .set({ status: 'error', updatedAt: new Date().toISOString() })
      .where(eq(dictionary.id, id))
  }

  /** 获取所有状态为 ready 的词典，按 sortOrder 排序 */
  async listReady(): Promise<Dictionary[]> {
    return this.db
      .select()
      .from(dictionary)
      .where(eq(dictionary.status, 'ready'))
      .orderBy(asc(dictionary.sortOrder), asc(dictionary.id))
  }

  /** 获取全部词典，按 sortOrder 排序 */
  async listAll(): Promise<Dictionary[]> {
    return this.db.select().from(dictionary).orderBy(asc(dictionary.sortOrder), asc(dictionary.id))
  }

  async listIds(): Promise<number[]> {
    const rows = await this.db
      .select({ id: dictionary.id })
      .from(dictionary)
      .orderBy(asc(dictionary.sortOrder), asc(dictionary.id))
    return rows.map((row) => row.id)
  }

  /** 根据 ID 查询单条词典记录 */
  async findById(id: number): Promise<Dictionary | undefined> {
    const [row] = await this.db.select().from(dictionary).where(eq(dictionary.id, id)).limit(1)
    return row
  }

  /** 删除指定 ID 的词典（cascade 会同步删除关联的 files & entries） */
  async deleteById(id: number): Promise<void> {
    await this.db.delete(dictionary).where(eq(dictionary.id, id))
  }

  /** 按传入的 ID 顺序重新设置 sortOrder */
  async reorder(ids: number[]): Promise<void> {
    const updatedAt = new Date().toISOString()
    this.db.transaction((tx) => {
      for (let i = 0; i < ids.length; i++) {
        tx.update(dictionary)
          .set({ sortOrder: i, updatedAt })
          .where(eq(dictionary.id, ids[i]))
          .run()
      }
    })
  }

  /** 更新词典名称 */
  async updateName(id: number, name: string): Promise<boolean> {
    const rows = await this.db
      .update(dictionary)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(eq(dictionary.id, id))
      .returning({ id: dictionary.id })
    return rows.length > 0
  }

  /** 更新自定义 CSS */
  async updateCustomCss(id: number, customCss: string): Promise<boolean> {
    const rows = await this.db
      .update(dictionary)
      .set({ customCss, updatedAt: new Date().toISOString() })
      .where(eq(dictionary.id, id))
      .returning({ id: dictionary.id })
    return rows.length > 0
  }
}
