import BetterSqlite3, { type Database } from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import * as schema from './schema'

export type DictolDatabase = BetterSQLite3Database<typeof schema>
export type SqliteDatabase = Database

export function createDBConnection(databasePath: string): SqliteDatabase {
  const connection = new BetterSqlite3(databasePath)
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('foreign_keys = ON')
  connection.pragma('temp_store = MEMORY')
  return connection
}

export type DictolDB = {
  db: SqliteDatabase
  orm: DictolDatabase
}

export function initDrizzleDB(databasePath: string, migrationsPath: string): DictolDB {
  const connection: SqliteDatabase = createDBConnection(databasePath)

  try {
    const orm = drizzle(connection, { schema })
    migrate(orm, { migrationsFolder: migrationsPath })
    return { db: connection, orm }
  } catch (error) {
    connection.close()
    throw error
  }
}

/** Opens an independent Drizzle connection without running migrations. */
export function openDrizzleDB(databasePath: string): DictolDB {
  const connection = createDBConnection(databasePath)
  return { db: connection, orm: drizzle(connection, { schema }) }
}
