import { relations, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const dictionary = sqliteTable(
  'dictionary',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    uuid: text('uuid')
      .notNull()
      .unique()
      .$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    description: text('description'),
    recordCount: integer('record_count'),
    dictPath: text('dict_path'),
    external: integer('external', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    customCss: text('custom_css').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status', { enum: ['pending', 'importing', 'ready', 'error'] })
      .notNull()
      .default('importing'),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [
    index('dictionary_sort_order_idx').on(table.sortOrder),
    index('dictionary_status_idx').on(table.status),
    check(
      'dictionary_status_check',
      sql`${table.status} in ('pending', 'importing', 'ready', 'error')`
    )
  ]
)

export const dictionaryIndex = sqliteTable(
  'dictionary_index',
  {
    dictionaryId: integer('dictionary_id')
      .primaryKey()
      .references(() => dictionary.id, { onDelete: 'cascade' }),
    formatVersion: integer('format_version').notNull().default(3),
    sourceFingerprint: text('source_fingerprint'),
    normalizationVersion: integer('normalization_version').notNull().default(2),
    comparisonVersion: integer('comparison_version').notNull().default(1),
    status: text('status', {
      enum: ['building', 'ready', 'error', 'needs_reindex']
    })
      .notNull()
      .default('building'),
    entryCount: integer('entry_count'),
    termCount: integer('term_count'),
    fileSize: integer('file_size'),
    builtAt: text('built_at'),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [
    index('dictionary_index_status_idx').on(table.status),
    check(
      'dictionary_index_status_check',
      sql`${table.status} in ('building', 'ready', 'error', 'needs_reindex')`
    )
  ]
)

export const dictionaryFile = sqliteTable(
  'dictionary_file',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    dictionaryId: integer('dictionary_id')
      .notNull()
      .references(() => dictionary.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    filePath: text('file_path').notNull().unique(),
    fileType: text('file_type', { enum: ['mdx', 'mdd'] }).notNull(),
    fileSize: integer('file_size'),
    lastModified: integer('last_modified', { mode: 'number' }),
    checksum: text('checksum'),
    formatVersion: text('format_version'),
    isEncrypted: integer('is_encrypted', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [
    index('dictionary_file_dictionary_id_idx').on(table.dictionaryId),
    index('dictionary_file_type_idx').on(table.fileType),
    check('dictionary_file_type_check', sql`${table.fileType} in ('mdx', 'mdd')`)
  ]
)

/** Legacy lookup rows retained temporarily while existing dictionaries migrate to DIDX. */
export const dictionaryEntry = sqliteTable(
  'dictionary_entry',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    dictionaryId: integer('dictionary_id')
      .notNull()
      .references(() => dictionary.id, { onDelete: 'cascade' }),
    dictionaryFileId: integer('dictionary_file_id')
      .notNull()
      .references(() => dictionaryFile.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
    normalizedWord: text('normalized_word').notNull(),
    recordStartOffset: integer('record_start_offset').notNull(),
    recordEndOffset: integer('record_end_offset').notNull()
  },
  (table) => [
    index('dictionary_entry_file_id_idx').on(table.dictionaryFileId),
    index('dictionary_entry_normalized_word_idx').on(table.normalizedWord),
    index('dictionary_entry_dictionary_id_normalized_word_idx').on(
      table.dictionaryId,
      table.normalizedWord
    )
  ]
)

export const queryHistory = sqliteTable(
  'query_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    term: text('term').notNull(),
    normalizedTerm: text('normalized_term').notNull().unique(),
    queryCount: integer('query_count').notNull().default(1),
    lastQueriedAt: text('last_queried_at').notNull().default(isoNow)
  },
  (table) => [index('query_history_last_queried_at_idx').on(table.lastQueriedAt)]
)

export const wordbook = sqliteTable(
  'wordbook',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [index('wordbook_default_idx').on(table.isDefault)]
)

export const wordbookWord = sqliteTable(
  'wordbook_word',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    wordbookId: integer('wordbook_id')
      .notNull()
      .references(() => wordbook.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
    normalizedWord: text('normalized_word').notNull().unique(),
    star: integer('star').notNull().default(0),
    dictionaryWord: text('dictionary_word'),
    phonetic: text('phonetic'),
    definition: text('definition'),
    translation: text('translation'),
    ecdictVersion: text('ecdict_version'),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [
    index('wordbook_word_wordbook_id_idx').on(table.wordbookId),
    index('wordbook_word_created_at_idx').on(table.createdAt),
    check('wordbook_word_star_check', sql`${table.star} between 0 and 5`)
  ]
)

export const dictionaryNote = sqliteTable(
  'dictionary_note',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    excerpt: text('excerpt'),
    comment: text('comment'),
    commentRich: text('comment_rich'),
    sourceDictionaryName: text('source_dictionary_name'),
    sourceEntryTerm: text('source_entry_term'),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [index('dictionary_note_created_at_idx').on(table.createdAt)]
)

export const dictionaryNoteWord = sqliteTable(
  'dictionary_note_word',
  {
    noteId: integer('note_id')
      .notNull()
      .references(() => dictionaryNote.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    normalizedTerm: text('normalized_term').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.normalizedTerm] }),
    index('dictionary_note_word_normalized_term_idx').on(table.normalizedTerm)
  ]
)

export const dictionaryNoteAttachment = sqliteTable(
  'dictionary_note_attachment',
  {
    id: text('id').primaryKey(),
    noteId: integer('note_id')
      .notNull()
      .references(() => dictionaryNote.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: text('created_at').notNull().default(isoNow)
  },
  (table) => [index('dictionary_note_attachment_note_id_idx').on(table.noteId)]
)

export const wordbookTag = sqliteTable(
  'wordbook_tag',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull().unique(),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [index('wordbook_tag_name_idx').on(table.name)]
)

export const wordbookWordTag = sqliteTable(
  'wordbook_word_tag',
  {
    wordbookWordId: integer('wordbook_word_id')
      .notNull()
      .references(() => wordbookWord.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => wordbookTag.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(isoNow)
  },
  (table) => [
    primaryKey({ columns: [table.wordbookWordId, table.tagId] }),
    index('wordbook_word_tag_tag_id_idx').on(table.tagId)
  ]
)

export const onlineDictionary = sqliteTable(
  'online_dictionary',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    faviconUrl: text('favicon_url').notNull(),
    urlTemplate: text('url_template').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [index('online_dictionary_sort_order_idx').on(table.sortOrder)]
)

export const dictionaryGroup = sqliteTable(
  'dictionary_group',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [index('dictionary_group_sort_order_idx').on(table.sortOrder)]
)

export const dictionaryGroupMember = sqliteTable(
  'dictionary_group_member',
  {
    groupId: integer('group_id')
      .notNull()
      .references(() => dictionaryGroup.id, { onDelete: 'cascade' }),
    dictionaryId: integer('dictionary_id')
      .notNull()
      .references(() => dictionary.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(isoNow),
    updatedAt: text('updated_at').notNull().default(isoNow)
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.dictionaryId] }),
    index('dictionary_group_member_group_sort_idx').on(table.groupId, table.sortOrder),
    index('dictionary_group_member_dictionary_id_idx').on(table.dictionaryId)
  ]
)

export const dictionaryRelations = relations(dictionary, ({ many, one }) => ({
  files: many(dictionaryFile),
  index: one(dictionaryIndex),
  groupMembers: many(dictionaryGroupMember)
}))

export const dictionaryGroupRelations = relations(dictionaryGroup, ({ many }) => ({
  members: many(dictionaryGroupMember)
}))

export const dictionaryGroupMemberRelations = relations(dictionaryGroupMember, ({ one }) => ({
  group: one(dictionaryGroup, {
    fields: [dictionaryGroupMember.groupId],
    references: [dictionaryGroup.id]
  }),
  dictionary: one(dictionary, {
    fields: [dictionaryGroupMember.dictionaryId],
    references: [dictionary.id]
  })
}))

export const dictionaryFileRelations = relations(dictionaryFile, ({ one }) => ({
  dictionary: one(dictionary, {
    fields: [dictionaryFile.dictionaryId],
    references: [dictionary.id]
  })
}))

export const dictionaryEntryRelations = relations(dictionaryEntry, ({ one }) => ({
  dictionary: one(dictionary, {
    fields: [dictionaryEntry.dictionaryId],
    references: [dictionary.id]
  }),
  file: one(dictionaryFile, {
    fields: [dictionaryEntry.dictionaryFileId],
    references: [dictionaryFile.id]
  })
}))

export const dictionaryIndexRelations = relations(dictionaryIndex, ({ one }) => ({
  dictionary: one(dictionary, {
    fields: [dictionaryIndex.dictionaryId],
    references: [dictionary.id]
  })
}))

export const wordbookRelations = relations(wordbook, ({ many }) => ({
  words: many(wordbookWord)
}))

export const wordbookWordRelations = relations(wordbookWord, ({ one }) => ({
  wordbook: one(wordbook, {
    fields: [wordbookWord.wordbookId],
    references: [wordbook.id]
  })
}))

export const dictionaryNoteRelations = relations(dictionaryNote, ({ one, many }) => ({
  sourceDictionary: one(dictionary, {
    fields: [dictionaryNote.sourceDictionaryId],
    references: [dictionary.id]
  }),
  words: many(dictionaryNoteWord)
}))

export const dictionaryNoteWordRelations = relations(dictionaryNoteWord, ({ one }) => ({
  note: one(dictionaryNote, {
    fields: [dictionaryNoteWord.noteId],
    references: [dictionaryNote.id]
  })
}))

export const wordbookTagRelations = relations(wordbookTag, ({ many }) => ({
  words: many(wordbookWordTag)
}))

export const wordbookWordTagRelations = relations(wordbookWordTag, ({ one }) => ({
  word: one(wordbookWord, {
    fields: [wordbookWordTag.wordbookWordId],
    references: [wordbookWord.id]
  }),
  tag: one(wordbookTag, {
    fields: [wordbookWordTag.tagId],
    references: [wordbookTag.id]
  })
}))

export type Dictionary = typeof dictionary.$inferSelect
export type NewDictionary = typeof dictionary.$inferInsert
export type DictionaryIndex = typeof dictionaryIndex.$inferSelect
export type NewDictionaryIndex = typeof dictionaryIndex.$inferInsert
export type DictionaryFile = typeof dictionaryFile.$inferSelect
export type NewDictionaryFile = typeof dictionaryFile.$inferInsert
export type DictionaryEntry = typeof dictionaryEntry.$inferSelect
export type NewDictionaryEntry = typeof dictionaryEntry.$inferInsert
export type QueryHistory = typeof queryHistory.$inferSelect
export type Wordbook = typeof wordbook.$inferSelect
export type NewWordbook = typeof wordbook.$inferInsert
export type WordbookWord = typeof wordbookWord.$inferSelect
export type NewWordbookWord = typeof wordbookWord.$inferInsert
export type DictionaryNote = typeof dictionaryNote.$inferSelect
export type NewDictionaryNote = typeof dictionaryNote.$inferInsert
export type WordbookTag = typeof wordbookTag.$inferSelect
export type NewWordbookTag = typeof wordbookTag.$inferInsert
export type OnlineDictionary = typeof onlineDictionary.$inferSelect
export type NewOnlineDictionary = typeof onlineDictionary.$inferInsert
export type DictionaryGroup = typeof dictionaryGroup.$inferSelect
export type NewDictionaryGroup = typeof dictionaryGroup.$inferInsert
export type DictionaryGroupMember = typeof dictionaryGroupMember.$inferSelect
export type NewDictionaryGroupMember = typeof dictionaryGroupMember.$inferInsert
