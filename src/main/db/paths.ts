import { app } from 'electron'
import { join } from 'node:path'

export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'dictol.sqlite')
}

export function getMigrationsPath(): string {
  return process.env.DICTOL_MIGRATIONS_PATH ?? join(app.getAppPath(), 'drizzle')
}

export function getDictionaryIndexRoot(): string {
  return join(app.getPath('userData'), 'dictionary-index')
}
