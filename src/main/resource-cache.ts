import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'

export class ResourceCache {
  private readonly rootDirectory: string

  constructor(rootDirectory = join(app.getPath('userData'), 'resource-cache')) {
    this.rootDirectory = rootDirectory
  }

  async read(dictionaryId: number, resourcePath: string, mimeType: string): Promise<Buffer | null> {
    const cachePath = this.getCachePath(dictionaryId, resourcePath, mimeType)
    if (!cachePath) return null

    try {
      return await readFile(cachePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async write(
    dictionaryId: number,
    resourcePath: string,
    mimeType: string,
    bytes: Buffer
  ): Promise<void> {
    const cachePath = this.getCachePath(dictionaryId, resourcePath, mimeType)
    if (!cachePath) return

    await mkdir(dirname(cachePath), { recursive: true })
    try {
      await writeFile(cachePath, bytes, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return
      throw error
    }
  }

  async removeDictionary(dictionaryId: number): Promise<void> {
    if (!Number.isSafeInteger(dictionaryId) || dictionaryId <= 0) return
    await rm(join(this.rootDirectory, String(dictionaryId)), { recursive: true, force: true })
  }

  async getSize(): Promise<number> {
    return this.getDirectorySize(this.rootDirectory)
  }

  async ensureDirectory(): Promise<string> {
    await mkdir(this.rootDirectory, { recursive: true })
    return this.rootDirectory
  }

  async clear(): Promise<void> {
    await rm(this.rootDirectory, { recursive: true, force: true })
  }

  private getCachePath(
    dictionaryId: number,
    resourcePath: string,
    mimeType: string
  ): string | null {
    const category = mimeType.startsWith('image/')
      ? 'images'
      : mimeType.startsWith('audio/')
        ? 'audio'
        : mimeType.startsWith('font/')
          ? 'fonts'
          : null
    if (!category) return null

    const digest = createHash('sha256').update(`${dictionaryId}\0${resourcePath}`).digest('hex')
    const shard = digest.slice(0, 6)
    const extension = extname(resourcePath)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '')

    return join(this.rootDirectory, String(dictionaryId), category, shard, `${digest}${extension}`)
  }

  private async getDirectorySize(directory: string): Promise<number> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }

    let size = 0
    for (const entry of entries) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        size += await this.getDirectorySize(entryPath)
        continue
      }

      try {
        size += (await stat(entryPath)).size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return size
  }
}
