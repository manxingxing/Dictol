import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { DictolDatabase } from '../drizzle'
import { dictionary, dictionaryNote, dictionaryNoteAttachment, dictionaryNoteWord } from '../schema'
import type { DictionaryNoteAttachmentItem } from '../../../shared/dictionary-note'

export type DictionaryNoteWithSource = Omit<typeof dictionaryNote.$inferSelect, 'id'> & {
  id: number
  relatedTerms: string[]
  attachments: DictionaryNoteAttachmentItem[]
  searchMatches?: DictionaryNoteSearchMatches
}

export type DictionaryNoteSearchMatches = {
  excerpt: string[]
  comment: string[]
}

export type DictionaryNoteWordGroup = {
  term: string
  normalizedTerm: string
  latestCreatedAt: string
  notes: DictionaryNoteWithSource[]
}

type SqlExecutor = Pick<DictolDatabase, 'run'>

function dictionaryNoteSearchCondition(query: string): SQL | undefined {
  if (!query) return undefined
  return sql`${dictionaryNote.id} IN (
    SELECT note_id
    FROM dictionary_note_fts
    WHERE dictionary_note_fts MATCH simple_query(${query}, 0)
  )`
}

function syncDictionaryNoteFts(tx: SqlExecutor, noteId: number): void {
  tx.run(sql`DELETE FROM dictionary_note_fts WHERE rowid = ${noteId}`)
  tx.run(sql`
    INSERT INTO dictionary_note_fts (rowid, note_id, excerpt, comment, terms)
    SELECT
      note.id,
      note.id,
      note.excerpt,
      note.comment,
      COALESCE((
        SELECT group_concat(related.term, ' ')
        FROM (
          SELECT dictionary_note_word.term
          FROM dictionary_note_word
          WHERE dictionary_note_word.note_id = note.id
          ORDER BY dictionary_note_word.normalized_term
        ) AS related
      ), '')
    FROM dictionary_note AS note
    WHERE note.id = ${noteId}
  `)
}

function parseSimpleHighlights(text: string | null, open: string, close: string): string[] {
  if (!text) return []
  const matches = new Set<string>()
  let offset = 0
  while (offset < text.length) {
    const start = text.indexOf(open, offset)
    if (start < 0) break
    const matchStart = start + open.length
    const end = text.indexOf(close, matchStart)
    if (end < 0) break
    const match = text.slice(matchStart, end)
    for (const token of match.match(/[A-Za-z]+|[0-9]+|[^A-Za-z0-9\s]/gu) ?? []) {
      matches.add(token)
    }
    offset = end + close.length
  }
  return [...matches]
}

export class DictionaryNoteRepository {
  constructor(private readonly db: DictolDatabase) {}

  // 查询一个词下的笔记
  async listByTerm(normalizedTerm: string): Promise<DictionaryNoteWithSource[]> {
    return await this.db
      .select({
        id: dictionaryNote.id,
        excerpt: dictionaryNote.excerpt,
        comment: dictionaryNote.comment,
        commentRich: dictionaryNote.commentRich,
        sourceDictionaryName: dictionaryNote.sourceDictionaryName,
        sourceEntryTerm: dictionaryNote.sourceEntryTerm,
        createdAt: dictionaryNote.createdAt,
        updatedAt: dictionaryNote.updatedAt
      })
      .from(dictionaryNote)
      .where(
        inArray(
          dictionaryNote.id,
          this.db
            .select({ noteId: dictionaryNoteWord.noteId })
            .from(dictionaryNoteWord)
            .where(eq(dictionaryNoteWord.normalizedTerm, normalizedTerm))
        )
      )
      .orderBy(asc(dictionaryNote.createdAt))
      .then((items) => this.attachRelations(items))
  }

  async countByTerm(normalizedTerm: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(dictionaryNoteWord)
      .where(eq(dictionaryNoteWord.normalizedTerm, normalizedTerm))
    return row?.total ?? 0
  }

  async search(
    query: string,
    limit: number,
    offset: number
  ): Promise<{ items: DictionaryNoteWithSource[]; total: number }> {
    const condition = dictionaryNoteSearchCondition(query)
    const [items, countRows] = await Promise.all([
      this.db
        .select({
          id: dictionaryNote.id,
          excerpt: dictionaryNote.excerpt,
          comment: dictionaryNote.comment,
          commentRich: dictionaryNote.commentRich,
          sourceDictionaryName: dictionaryNote.sourceDictionaryName,
          sourceEntryTerm: dictionaryNote.sourceEntryTerm,
          createdAt: dictionaryNote.createdAt,
          updatedAt: dictionaryNote.updatedAt
        })
        .from(dictionaryNote)
        .where(condition)
        .orderBy(desc(dictionaryNote.createdAt), desc(dictionaryNote.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(dictionaryNote).where(condition)
    ])

    return {
      items: await this.attachSearchResults(query, items),
      total: countRows[0]?.total ?? 0
    }
  }

  async searchByWord(
    query: string,
    limit: number,
    offset: number
  ): Promise<{ items: DictionaryNoteWordGroup[]; total: number }> {
    const condition = dictionaryNoteSearchCondition(query)
    const latestCreatedAt = sql<string>`max(${dictionaryNote.createdAt})`
    const [wordRows, totalRows] = await Promise.all([
      this.db
        .select({
          term: sql<string>`min(${dictionaryNoteWord.term})`,
          normalizedTerm: dictionaryNoteWord.normalizedTerm,
          latestCreatedAt
        })
        .from(dictionaryNoteWord)
        .innerJoin(dictionaryNote, eq(dictionaryNoteWord.noteId, dictionaryNote.id))
        .where(condition)
        .groupBy(dictionaryNoteWord.normalizedTerm)
        .orderBy(desc(latestCreatedAt), asc(dictionaryNoteWord.normalizedTerm))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(distinct ${dictionaryNoteWord.normalizedTerm})` })
        .from(dictionaryNoteWord)
        .innerJoin(dictionaryNote, eq(dictionaryNoteWord.noteId, dictionaryNote.id))
        .where(condition)
    ])

    if (wordRows.length === 0) return { items: [], total: totalRows[0]?.total ?? 0 }

    const normalizedTerms = wordRows.map((row) => row.normalizedTerm)
    const noteRows = await this.db
      .select({
        groupNormalizedTerm: dictionaryNoteWord.normalizedTerm,
        id: dictionaryNote.id,
        excerpt: dictionaryNote.excerpt,
        comment: dictionaryNote.comment,
        commentRich: dictionaryNote.commentRich,
        sourceDictionaryName: dictionaryNote.sourceDictionaryName,
        sourceEntryTerm: dictionaryNote.sourceEntryTerm,
        createdAt: dictionaryNote.createdAt,
        updatedAt: dictionaryNote.updatedAt
      })
      .from(dictionaryNoteWord)
      .innerJoin(dictionaryNote, eq(dictionaryNoteWord.noteId, dictionaryNote.id))
      .where(inArray(dictionaryNoteWord.normalizedTerm, normalizedTerms))
      .orderBy(desc(dictionaryNote.createdAt))

    const notesWithRelations = await this.attachSearchResults(query, noteRows)
    const notesByWord = new Map<string, DictionaryNoteWithSource[]>()
    noteRows.forEach((row, index) => {
      const { groupNormalizedTerm, ...note } = row
      const notes = notesByWord.get(groupNormalizedTerm) ?? []
      notes.push(notesWithRelations[index] ?? { ...note, relatedTerms: [], attachments: [] })
      notesByWord.set(groupNormalizedTerm, notes)
    })

    return {
      items: wordRows.map((row) => ({
        ...row,
        notes: notesByWord.get(row.normalizedTerm) ?? []
      })),
      total: totalRows[0]?.total ?? 0
    }
  }

  async create(input: {
    excerpt: string | null
    comment: string | null
    commentRich: string | null
    sourceDictionaryId: number | null
    sourceEntryTerm: string | null
    relatedTerms: { term: string; normalizedTerm: string }[]
    attachments: Omit<typeof dictionaryNoteAttachment.$inferInsert, 'noteId'>[]
  }): Promise<DictionaryNoteWithSource> {
    const { relatedTerms, attachments, sourceDictionaryId, ...noteInput } = input
    const created = this.db.transaction((tx) => {
      let sourceDictionaryName: string | null = null
      if (sourceDictionaryId !== null) {
        const [sourceDictionary] = tx
          .select({ name: dictionary.name })
          .from(dictionary)
          .where(eq(dictionary.id, sourceDictionaryId))
          .limit(1)
          .all()
        sourceDictionaryName = sourceDictionary?.name ?? null
      }
      const [note] = tx
        .insert(dictionaryNote)
        .values({ ...noteInput, sourceDictionaryName })
        .returning()
        .all()
      if (!note) throw new Error('保存摘抄失败')
      if (relatedTerms.length > 0) {
        tx.insert(dictionaryNoteWord)
          .values(relatedTerms.map((relatedTerm) => ({ noteId: note.id, ...relatedTerm })))
          .run()
      }
      if (attachments.length > 0) {
        tx.insert(dictionaryNoteAttachment)
          .values(attachments.map((attachment) => ({ ...attachment, noteId: note.id })))
          .run()
      }
      syncDictionaryNoteFts(tx, note.id)
      return note
    })
    const [saved] = await this.listById(created.id)
    if (!saved) throw new Error('保存摘抄失败')
    return saved
  }

  async updateContent(
    id: number,
    content: {
      comment: string | null
      commentRich: string | null
    }
  ): Promise<void> {
    this.db.transaction((tx) => {
      const [note] = tx
        .select({ excerpt: dictionaryNote.excerpt })
        .from(dictionaryNote)
        .where(eq(dictionaryNote.id, id))
        .limit(1)
        .all()
      if (!note) return
      if (!note.excerpt?.trim() && !content.comment) {
        const [attachment] = tx
          .select({ id: dictionaryNoteAttachment.id })
          .from(dictionaryNoteAttachment)
          .where(eq(dictionaryNoteAttachment.noteId, id))
          .limit(1)
          .all()
        if (!attachment) throw new Error('摘抄、笔记或图片不能同时为空')
      }

      tx.update(dictionaryNote)
        .set({
          comment: content.comment,
          commentRich: content.commentRich,
          updatedAt: new Date().toISOString()
        })
        .where(eq(dictionaryNote.id, id))
        .run()
      syncDictionaryNoteFts(tx, id)
    })
  }

  async delete(id: number): Promise<void> {
    this.db.transaction((tx) => {
      tx.run(sql`DELETE FROM dictionary_note_fts WHERE rowid = ${id}`)
      tx.delete(dictionaryNoteWord).where(eq(dictionaryNoteWord.noteId, id)).run()
      tx.delete(dictionaryNote).where(eq(dictionaryNote.id, id)).run()
    })
  }

  async listAttachmentStorageKeys(id: number): Promise<string[]> {
    const rows = await this.db
      .select({ storageKey: dictionaryNoteAttachment.storageKey })
      .from(dictionaryNoteAttachment)
      .where(eq(dictionaryNoteAttachment.noteId, id))
    return rows.map((row) => row.storageKey)
  }

  async hasAttachment(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: dictionaryNoteAttachment.id })
      .from(dictionaryNoteAttachment)
      .where(eq(dictionaryNoteAttachment.id, id))
      .limit(1)
    return row !== undefined
  }

  async removeAttachment(noteId: number, attachmentId: string): Promise<string | null> {
    return this.db.transaction((tx) => {
      const [attachment] = tx
        .select({ storageKey: dictionaryNoteAttachment.storageKey })
        .from(dictionaryNoteAttachment)
        .where(
          and(
            eq(dictionaryNoteAttachment.noteId, noteId),
            eq(dictionaryNoteAttachment.id, attachmentId)
          )
        )
        .limit(1)
        .all()
      if (!attachment) return null
      tx.delete(dictionaryNoteAttachment).where(eq(dictionaryNoteAttachment.id, attachmentId)).run()
      return attachment.storageKey
    })
  }

  private async listById(id: number): Promise<DictionaryNoteWithSource[]> {
    return await this.db
      .select({
        id: dictionaryNote.id,
        excerpt: dictionaryNote.excerpt,
        comment: dictionaryNote.comment,
        commentRich: dictionaryNote.commentRich,
        sourceDictionaryName: dictionaryNote.sourceDictionaryName,
        sourceEntryTerm: dictionaryNote.sourceEntryTerm,
        createdAt: dictionaryNote.createdAt,
        updatedAt: dictionaryNote.updatedAt
      })
      .from(dictionaryNote)
      .where(eq(dictionaryNote.id, id))
      .limit(1)
      .then((items) => this.attachRelations(items))
  }

  private async attachSearchResults<T extends { id: number }>(
    query: string,
    items: T[]
  ): Promise<
    (T & {
      relatedTerms: string[]
      attachments: DictionaryNoteAttachmentItem[]
      searchMatches?: DictionaryNoteSearchMatches
    })[]
  > {
    return this.attachSearchMatches(query, await this.attachRelations(items))
  }

  private async attachSearchMatches<T extends { id: number }>(
    query: string,
    notes: T[]
  ): Promise<(T & { searchMatches?: DictionaryNoteSearchMatches })[]> {
    if (!query || notes.length === 0) return notes

    const open = `\uE000${randomUUID()}-open\uE001`
    const close = `\uE000${randomUUID()}-close\uE001`
    const noteIds = sql.join(
      notes.map((note) => sql`${note.id}`),
      sql`, `
    )
    const rows = this.db.all<{
      noteId: number
      excerpt: string | null
      comment: string | null
    }>(sql`
      SELECT
        note_id AS noteId,
        simple_highlight(dictionary_note_fts, 1, ${open}, ${close}) AS excerpt,
        simple_highlight(dictionary_note_fts, 2, ${open}, ${close}) AS comment
      FROM dictionary_note_fts
      WHERE dictionary_note_fts MATCH simple_query(${query}, 0)
        AND note_id IN (${noteIds})
    `)
    const matchesByNoteId = new Map(
      rows.map((row) => [
        row.noteId,
        {
          excerpt: parseSimpleHighlights(row.excerpt, open, close),
          comment: parseSimpleHighlights(row.comment, open, close)
        } satisfies DictionaryNoteSearchMatches
      ])
    )

    return notes.map((note) => ({ ...note, searchMatches: matchesByNoteId.get(note.id) }))
  }

  private async attachRelatedTerms<T extends { id: number }>(
    items: T[]
  ): Promise<(T & { relatedTerms: string[] })[]> {
    if (items.length === 0) return []
    const rows = await this.db
      .select({ noteId: dictionaryNoteWord.noteId, term: dictionaryNoteWord.term })
      .from(dictionaryNoteWord)
      .where(
        inArray(
          dictionaryNoteWord.noteId,
          items.map((item) => item.id)
        )
      )
      .orderBy(dictionaryNoteWord.term)
    const termsByNote = new Map<number, string[]>()
    for (const row of rows) {
      const terms = termsByNote.get(row.noteId) ?? []
      terms.push(row.term)
      termsByNote.set(row.noteId, terms)
    }

    return items.map((item) => ({
      ...item,
      relatedTerms: termsByNote.get(item.id) ?? []
    }))
  }

  private async attachAttachments<T extends { id: number }>(
    items: T[]
  ): Promise<(T & { attachments: DictionaryNoteAttachmentItem[] })[]> {
    if (items.length === 0) return []
    const attachmentRows = await this.db
      .select({
        noteId: dictionaryNoteAttachment.noteId,
        id: dictionaryNoteAttachment.id,
        storageKey: dictionaryNoteAttachment.storageKey,
        mimeType: dictionaryNoteAttachment.mimeType,
        byteSize: dictionaryNoteAttachment.byteSize,
        width: dictionaryNoteAttachment.width,
        height: dictionaryNoteAttachment.height
      })
      .from(dictionaryNoteAttachment)
      .where(
        inArray(
          dictionaryNoteAttachment.noteId,
          items.map((item) => item.id)
        )
      )
      .orderBy(dictionaryNoteAttachment.createdAt)
    const attachmentsByNote = new Map<number, DictionaryNoteAttachmentItem[]>()
    for (const row of attachmentRows) {
      const attachments = attachmentsByNote.get(row.noteId) ?? []
      attachments.push({
        id: row.id,
        storageKey: row.storageKey,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        width: row.width,
        height: row.height
      })
      attachmentsByNote.set(row.noteId, attachments)
    }
    return items.map((item) => ({
      ...item,
      attachments: attachmentsByNote.get(item.id) ?? []
    }))
  }

  private async attachRelations<T extends { id: number }>(
    items: T[]
  ): Promise<(T & { relatedTerms: string[]; attachments: DictionaryNoteAttachmentItem[] })[]> {
    return this.attachRelatedTerms(await this.attachAttachments(items))
  }
}
