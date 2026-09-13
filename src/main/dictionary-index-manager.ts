import { DidxIndex } from '@dictol/mdict-native'
import { and, asc, eq } from 'drizzle-orm'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import type { DictolDatabase } from './db/drizzle'
import { dictionary, dictionaryFile, dictionaryIndex } from './db/schema'

export type DictionaryIndexDescriptor = {
  dictionaryId: number
  dictionaryUuid: string
  dictionaryName: string
  mdxPath: string
  indexPath: string
}

export type OpenDictionaryIndex = DictionaryIndexDescriptor & {
  index: DidxIndex
}

export class DictionaryIndexInitializationError extends Error {
  constructor(
    readonly dictionaryName: string,
    cause: unknown
  ) {
    super(`无法初始化词典索引「${dictionaryName}」`, { cause })
    this.name = 'DictionaryIndexInitializationError'
  }
}

/** Owns lazily opened DIDX readers for registered MDX dictionaries. */
export class DictionaryIndexManager {
  private readonly sources = new Map<number, DictionaryIndexDescriptor>()
  private readonly indexes = new Map<number, OpenDictionaryIndex>()
  private readonly opening = new Map<number, Promise<OpenDictionaryIndex>>()
  private readonly validating = new Map<number, Set<Promise<void>>>()
  private readonly changing = new Set<number>()
  private readonly openConcurrency: number
  private initialized = false
  private disposed = false

  constructor(
    private readonly db: DictolDatabase,
    private readonly indexRoot: string,
    openConcurrency = 8
  ) {
    if (!Number.isSafeInteger(openConcurrency) || openConcurrency < 1) {
      throw new Error('索引打开并发数必须是大于 0 的整数')
    }
    this.openConcurrency = openConcurrency
  }

  async initialize(): Promise<void> {
    if (this.disposed) throw new Error('词典索引管理器已销毁')
    if (this.initialized) return

    const sources = this.loadSources()
    this.sources.clear()
    for (const source of sources) this.sources.set(source.dictionaryId, source)
    // Startup only loads descriptors. Source checks and mmap are lazy;
    // full validation is an explicit maintenance operation.
    this.initialized = true
  }

  /** Return a loaded index without causing I/O. */
  get(dictionaryId: number): OpenDictionaryIndex | undefined {
    this.assertAvailable(dictionaryId)
    return this.indexes.get(dictionaryId)
  }

  /** Return a loaded index or fail; use acquireRequired for lazy loading. */
  getRequired(dictionaryId: number): OpenDictionaryIndex {
    const item = this.get(dictionaryId)
    if (!item) throw new Error(`词典索引尚未初始化：${dictionaryId}`)
    return item
  }

  getAll(): OpenDictionaryIndex[] {
    return [...this.indexes.values()].filter((item) => !this.changing.has(item.dictionaryId))
  }

  private async invalidate(dictionaryId: number): Promise<void> {
    const opened = this.indexes.get(dictionaryId)
    if (!opened) return
    await this.closeIndex(opened.index)
    this.indexes.delete(dictionaryId)
  }

  /** Drain readers being opened/validated before deleting or replacing files.
   * Successful replacement remains lazy; failure also drops stale descriptors.
   */
  async change<T>(dictionaryId: number, operation: () => Promise<T>): Promise<T> {
    this.assertAvailable(dictionaryId)
    this.changing.add(dictionaryId)
    try {
      const pending = this.opening.get(dictionaryId)
      await Promise.allSettled([
        ...(pending ? [pending] : []),
        ...(this.validating.get(dictionaryId) ?? [])
      ])
      if (this.disposed) throw new Error('词典索引管理器已销毁')
      await this.invalidate(dictionaryId)
      this.sources.delete(dictionaryId)
      return await operation()
    } finally {
      this.sources.delete(dictionaryId)
      this.changing.delete(dictionaryId)
    }
  }

  async validate(dictionaryId: number): Promise<void> {
    this.assertAvailable(dictionaryId)
    const source = this.resolveSource(dictionaryId)
    const pending = this.validateSource(source)
    const tasks = this.validating.get(dictionaryId) ?? new Set<Promise<void>>()
    this.validating.set(dictionaryId, tasks)
    tasks.add(pending)
    try {
      await pending
    } finally {
      tasks.delete(pending)
      if (tasks.size === 0) this.validating.delete(dictionaryId)
    }
  }

  private async validateSource(source: DictionaryIndexDescriptor): Promise<void> {
    const { index } = await this.open(source)
    try {
      if (this.disposed) throw new Error('词典索引管理器已销毁')
      await index.validate()
    } finally {
      index.close()
    }
  }

  list(): DictionaryIndexDescriptor[] {
    return [...this.sources.values()]
  }

  async acquire(dictionaryId: number): Promise<OpenDictionaryIndex> {
    this.assertAvailable(dictionaryId)

    const cached = this.indexes.get(dictionaryId)
    if (cached) return cached
    let pending = this.opening.get(dictionaryId)
    if (!pending) {
      const source = this.resolveSource(dictionaryId)
      pending = this.open(source)
        .then((opened) => {
          if (this.disposed || this.changing.has(dictionaryId)) {
            opened.index.close()
            throw new Error('词典索引已失效，请重新查询')
          }
          this.indexes.set(dictionaryId, opened)
          return opened
        })
        .finally(() => {
          if (this.opening.get(dictionaryId) === pending) this.opening.delete(dictionaryId)
        })
      this.opening.set(dictionaryId, pending)
    }
    return pending
  }

  async acquireRequired(dictionaryId: number): Promise<OpenDictionaryIndex> {
    return this.acquire(dictionaryId)
  }

  async acquireMany(dictionaryIds: readonly number[]): Promise<OpenDictionaryIndex[]> {
    return mapWithConcurrency(dictionaryIds, this.openConcurrency, (dictionaryId) =>
      this.acquireRequired(dictionaryId)
    )
  }

  dispose(): void {
    this.disposed = true
    for (const item of this.indexes.values()) {
      void this.closeIndex(item.index).catch((error) =>
        console.error('Failed to close dictionary index', error)
      )
    }
    this.indexes.clear()
    this.sources.clear()
    this.opening.clear()
    this.validating.clear()
  }

  private loadSources(dictionaryId?: number): DictionaryIndexDescriptor[] {
    const rows = this.db
      .select({
        dictionaryId: dictionary.id,
        dictionaryUuid: dictionary.uuid,
        dictionaryName: dictionary.name,
        mdxPath: dictionaryFile.filePath
      })
      .from(dictionary)
      .innerJoin(
        dictionaryFile,
        and(eq(dictionaryFile.dictionaryId, dictionary.id), eq(dictionaryFile.fileType, 'mdx'))
      )
      .innerJoin(dictionaryIndex, eq(dictionaryIndex.dictionaryId, dictionary.id))
      .where(
        and(
          eq(dictionaryIndex.status, 'ready'),
          dictionaryId === undefined ? undefined : eq(dictionary.id, dictionaryId)
        )
      )
      .orderBy(asc(dictionary.sortOrder), asc(dictionary.id), asc(dictionaryFile.id))
      .all()

    const seen = new Set<number>()
    const sources: DictionaryIndexDescriptor[] = []
    for (const row of rows) {
      if (seen.has(row.dictionaryId)) {
        throw new Error(`词典包含多个 MDX 文件，无法初始化 DIDX：${row.dictionaryName}`)
      }
      if (!row.dictionaryUuid) {
        throw new Error(`词典缺少 UUID，无法初始化 DIDX：${row.dictionaryName}`)
      }
      seen.add(row.dictionaryId)
      sources.push({
        dictionaryId: row.dictionaryId,
        dictionaryUuid: row.dictionaryUuid,
        dictionaryName: row.dictionaryName,
        mdxPath: row.mdxPath,
        indexPath: join(this.indexRoot, row.dictionaryUuid, 'index.didx')
      })
    }
    return sources
  }

  private assertAvailable(dictionaryId: number): void {
    if (this.disposed) throw new Error('词典索引管理器已销毁')
    if (!this.initialized) throw new Error('词典索引管理器尚未初始化')
    if (this.changing.has(dictionaryId)) throw new Error('词典索引正在更新，请稍后重试')
  }

  private async closeIndex(index: DidxIndex): Promise<void> {
    // Native close returns false while a query still owns the mmap.
    for (let attempt = 0; attempt <= 100; attempt += 1) {
      if (index.close()) return
      if (attempt < 100) await delay(50)
    }
    throw new Error('词典索引仍有查询未结束，无法安全关闭，请稍后重试')
  }

  private resolveSource(dictionaryId: number): DictionaryIndexDescriptor {
    // Read the current ready record on cache misses and explicit validation.
    // No file is opened when a dictionary is imported or the app starts.
    const source = this.loadSources(dictionaryId)[0]
    if (!source) {
      this.sources.delete(dictionaryId)
      throw new Error(`数据库中不存在可用词典索引：${dictionaryId}`)
    }
    this.sources.set(dictionaryId, source)
    return source
  }

  private async open(source: DictionaryIndexDescriptor): Promise<OpenDictionaryIndex> {
    try {
      // openForMdx verifies the source fingerprint and DIDX header/directory.
      // Full validation belongs to build and maintenance paths, not the first query.
      const index = await DidxIndex.openForMdx(source.indexPath, source.mdxPath)
      return {
        ...source,
        dictionaryUuid: source.dictionaryUuid,
        indexPath: source.indexPath,
        index
      }
    } catch (error) {
      throw new DictionaryIndexInitializationError(source.dictionaryName, error)
    }
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++
      if (index >= values.length) return
      results[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return results
}
