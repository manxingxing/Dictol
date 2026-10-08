import { app } from 'electron'
import { join } from 'node:path'

export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'dictol.sqlite')
}

export function getMigrationsPath(): string {
  return process.env.DICTOL_MIGRATIONS_PATH ?? join(app.getAppPath(), 'drizzle')
}

export function getSqliteSimpleExtensionPath(): string {
  const target = `${process.platform}-${process.arch}`
  const extensionDirectory = app.isPackaged
    ? join(process.resourcesPath, 'sqlite-simple', target)
    : join(app.getAppPath(), 'resources', 'sqlite-simple', target)
  // better-sqlite3 appends the platform library suffix internally.
  return join(extensionDirectory, process.platform === 'win32' ? 'simple' : 'libsimple')
}

export function getDictionaryIndexRoot(): string {
  return join(app.getPath('userData'), 'dictionary-index')
}
