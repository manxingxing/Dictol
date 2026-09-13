import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'

import type { DictolDatabase } from '../drizzle'
import {
  dictionary,
  dictionaryGroup,
  dictionaryGroupMember,
  dictionaryIndex,
  type DictionaryGroup
} from '../schema'

export type SearchDictionaryGroup = {
  id: number
  name: string
  dictionaryCount: number
}

export type DictionaryGroupWithMembers = Pick<DictionaryGroup, 'id' | 'name' | 'sortOrder'> & {
  dictionaryIds: number[]
}

export class DictionaryGroupRepository {
  constructor(private readonly db: DictolDatabase) {}

  async listAll(): Promise<DictionaryGroupWithMembers[]> {
    const groups = await this.db
      .select({
        id: dictionaryGroup.id,
        name: dictionaryGroup.name,
        sortOrder: dictionaryGroup.sortOrder
      })
      .from(dictionaryGroup)
      .orderBy(asc(dictionaryGroup.sortOrder), asc(dictionaryGroup.id))
    const members = await this.db
      .select({
        groupId: dictionaryGroupMember.groupId,
        dictionaryId: dictionaryGroupMember.dictionaryId
      })
      .from(dictionaryGroupMember)
      .orderBy(asc(dictionaryGroupMember.sortOrder), asc(dictionaryGroupMember.dictionaryId))

    const memberIdsByGroup = new Map<number, number[]>()
    for (const member of members) {
      const ids = memberIdsByGroup.get(member.groupId) ?? []
      ids.push(member.dictionaryId)
      memberIdsByGroup.set(member.groupId, ids)
    }

    return groups.map((group) => ({
      ...group,
      dictionaryIds: memberIdsByGroup.get(group.id) ?? []
    }))
  }

  async create(name: string): Promise<DictionaryGroup> {
    const [created] = await this.db
      .insert(dictionaryGroup)
      .values({
        name,
        sortOrder: sql<number>`coalesce((select max(${dictionaryGroup.sortOrder}) from ${dictionaryGroup}), -1) + 1`
      })
      .returning()
    if (!created) throw new Error('创建词典组失败')
    return created
  }

  async updateName(id: number, name: string): Promise<boolean> {
    const rows = await this.db
      .update(dictionaryGroup)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(eq(dictionaryGroup.id, id))
      .returning({ id: dictionaryGroup.id })
    return rows.length > 0
  }

  async deleteById(id: number): Promise<boolean> {
    const rows = await this.db
      .delete(dictionaryGroup)
      .where(eq(dictionaryGroup.id, id))
      .returning({ id: dictionaryGroup.id })
    return rows.length > 0
  }

  async updateMembers(id: number, dictionaryIds: number[]): Promise<void> {
    const group = await this.db
      .select({ id: dictionaryGroup.id })
      .from(dictionaryGroup)
      .where(eq(dictionaryGroup.id, id))
      .limit(1)
    if (group.length === 0) throw new Error('词典组不存在')

    const uniqueDictionaryIds = [...new Set(dictionaryIds)]
    if (uniqueDictionaryIds.length > 0) {
      const existing = await this.db
        .select({ id: dictionary.id })
        .from(dictionary)
        .where(inArray(dictionary.id, uniqueDictionaryIds))
      if (existing.length !== uniqueDictionaryIds.length) throw new Error('词典组包含不存在的词典')
    }

    const updatedAt = new Date().toISOString()
    this.db.transaction((tx) => {
      tx.delete(dictionaryGroupMember).where(eq(dictionaryGroupMember.groupId, id)).run()
      if (uniqueDictionaryIds.length > 0) {
        tx.insert(dictionaryGroupMember)
          .values(
            uniqueDictionaryIds.map((dictionaryId, index) => ({
              groupId: id,
              dictionaryId,
              sortOrder: index,
              createdAt: updatedAt,
              updatedAt
            }))
          )
          .run()
      }
      tx.update(dictionaryGroup).set({ updatedAt }).where(eq(dictionaryGroup.id, id)).run()
    })
  }

  async listSearchable(): Promise<SearchDictionaryGroup[]> {
    return this.db
      .select({
        id: dictionaryGroup.id,
        name: dictionaryGroup.name,
        dictionaryCount: count(dictionaryGroupMember.dictionaryId)
      })
      .from(dictionaryGroupMember)
      .innerJoin(dictionaryGroup, eq(dictionaryGroupMember.groupId, dictionaryGroup.id))
      .innerJoin(dictionary, eq(dictionaryGroupMember.dictionaryId, dictionary.id))
      .innerJoin(dictionaryIndex, eq(dictionaryIndex.dictionaryId, dictionary.id))
      .where(
        and(
          eq(dictionary.status, 'ready'),
          eq(dictionary.enabled, true),
          eq(dictionaryIndex.status, 'ready')
        )
      )
      .groupBy(dictionaryGroup.id)
      .orderBy(asc(dictionaryGroup.sortOrder), asc(dictionaryGroup.id))
  }

  async listSearchableMemberIds(groupId: number): Promise<number[]> {
    const rows = await this.db
      .select({ dictionaryId: dictionaryGroupMember.dictionaryId })
      .from(dictionaryGroupMember)
      .innerJoin(dictionary, eq(dictionaryGroupMember.dictionaryId, dictionary.id))
      .innerJoin(dictionaryIndex, eq(dictionaryIndex.dictionaryId, dictionary.id))
      .where(
        and(
          eq(dictionaryGroupMember.groupId, groupId),
          eq(dictionary.status, 'ready'),
          eq(dictionary.enabled, true),
          eq(dictionaryIndex.status, 'ready')
        )
      )
      .orderBy(asc(dictionaryGroupMember.sortOrder), asc(dictionaryGroupMember.dictionaryId))
    return rows.map(({ dictionaryId }) => dictionaryId)
  }
}
