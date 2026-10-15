import { desc, eq, sql } from 'drizzle-orm'
import { DictolDatabase } from '../drizzle'
import { QueryHistory, queryHistory } from '../schema'

export type { QueryHistory } from '../schema'

type QueryHistoryListItem = Pick<QueryHistory, 'id' | 'term' | 'queryCount' | 'lastQueriedAt'>

export class QueryHistoryRepository {
  private db: DictolDatabase

  constructor(db: DictolDatabase) {
    this.db = db
  }

  /** 写入或更新查询记录（normalizedTerm 唯一，冲突时 term 覆盖 + queryCount+1） */
  async upsert(term: string, normalizedTerm: string): Promise<void> {
    const lastQueriedAt = new Date().toISOString()
    await this.db
      .insert(queryHistory)
      .values({ term, normalizedTerm, queryCount: 1, lastQueriedAt })
      .onConflictDoUpdate({
        target: queryHistory.normalizedTerm,
        set: {
          term,
          queryCount: sql`${queryHistory.queryCount} + 1`,
          lastQueriedAt
        }
      })
  }

  /** 列出查询历史，最多 300 条 */
  async listRecent(limit = 300): Promise<QueryHistoryListItem[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500)
    return this.db
      .select({
        id: queryHistory.id,
        term: queryHistory.term,
        queryCount: queryHistory.queryCount,
        lastQueriedAt: queryHistory.lastQueriedAt
      })
      .from(queryHistory)
      .orderBy(desc(queryHistory.lastQueriedAt), desc(queryHistory.id))
      .limit(safeLimit)
  }

  /** 清空全部查询历史 */
  async clear(): Promise<void> {
    await this.db.delete(queryHistory)
  }

  /** 删除超过指定条数的旧记录，保留最近 N 条 */
  async trimTo(maxRows = 300): Promise<void> {
    const safeMax = Math.max(Math.trunc(maxRows), 1)

    // 子查询：找到第 N 条记录的 last_queried_at / id，删除比它更旧的
    const [cutoff] = await this.db
      .select({
        lastQueriedAt: queryHistory.lastQueriedAt,
        id: queryHistory.id
      })
      .from(queryHistory)
      .orderBy(desc(queryHistory.lastQueriedAt), desc(queryHistory.id))
      .limit(1)
      .offset(safeMax - 1)

    if (!cutoff) return

    await this.db
      .delete(queryHistory)
      .where(
        sql`(${queryHistory.lastQueriedAt}, ${queryHistory.id}) < (${cutoff.lastQueriedAt}, ${cutoff.id})`
      )
  }

  /** 根据 id 删除单条记录 */
  async deleteById(id: number): Promise<void> {
    await this.db.delete(queryHistory).where(eq(queryHistory.id, id))
  }
}
