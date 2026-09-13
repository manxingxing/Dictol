import { DidxIndex, Mdx } from '@dictol/mdict-native'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { performance } from 'node:perf_hooks'

import type { DictionaryImportSourceFile } from '../shared/dictionary-import'
import { openDrizzleDB } from './db/drizzle'
import { dictionary, dictionaryFile, dictionaryIndex } from './db/schema'

const DIDX_COMPARISON_VERSION = 1
const DIDX_FORMAT_VERSION = 3
const DIDX_NORMALIZATION_VERSION = 2
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DidxImportRequest = {
  mdxPath: string
  /** 只保存这些源文件的位置，不复制文件。至少包含 mdxPath。 */
  sourceFiles: DictionaryImportSourceFile[]
  name?: string
}

export type DidxImportResult = {
  dictionaryId: number
  dictionaryUuid: string
  indexPath: string
  entryCount: bigint
  termCount: bigint
  fileSize: bigint
  indexElapsedMs: number
  elapsedMs: number
}

export type DidxImportOutcome =
  | { mdxPath: string; status: 'ready'; result: DidxImportResult }
  | { mdxPath: string; status: 'error'; error: string }

/** 将词典 UUID 映射到唯一的 DIDX 目录和文件。 */
export function getDictionaryIndexPath(indexRoot: string, dictionaryUuid: string): string {
  if (!UUID_PATTERN.test(dictionaryUuid)) throw new Error(`无效的词典 UUID：${dictionaryUuid}`)
  return join(indexRoot, dictionaryUuid, 'index.didx')
}

/**
 * 以固定数量的并发任务处理输入，结果顺序与输入顺序一致。
 * 该函数不启动全量 Promise，适合批量打开和构建大型 MDX。
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('并发数必须是大于 0 的整数')
  }

  const results = new Array<R>(values.length)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++
      if (index >= values.length) return
      results[index] = await mapper(values[index], index)
    }
  }

  const workerCount = Math.min(concurrency, values.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/**
 * DIDX 的独立导入/重建服务，供脚本和维护任务使用。
 *
 * 应用正常导入由 dictionary-import-worker 负责；该服务不参与每次查询。
 */
export class DidxImportService {
  private readonly databasePath: string
  private readonly indexRoot: string
  private readonly concurrency: number

  constructor(databasePath: string, indexRoot: string, concurrency = 2) {
    this.databasePath = databasePath
    this.indexRoot = indexRoot
    this.concurrency = concurrency
  }

  async importMany(requests: readonly DidxImportRequest[]): Promise<DidxImportOutcome[]> {
    return mapWithConcurrency(requests, this.concurrency, async (request) => {
      try {
        return {
          mdxPath: request.mdxPath,
          status: 'ready',
          result: await this.importOne(request)
        } satisfies DidxImportOutcome
      } catch (error) {
        return {
          mdxPath: request.mdxPath,
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        } satisfies DidxImportOutcome
      }
    })
  }

  async openOrRebuild(dictionaryId: number, forceRebuild = false): Promise<DidxIndex> {
    const { db: connection, orm } = openDrizzleDB(this.databasePath)
    try {
      const [existingDictionary] = await orm
        .select({ id: dictionary.id })
        .from(dictionary)
        .where(eq(dictionary.id, dictionaryId))
        .limit(1)
      if (!existingDictionary) throw new Error(`未找到词典：${dictionaryId}`)

      await orm
        .insert(dictionaryIndex)
        .values({
          dictionaryId,
          formatVersion: DIDX_FORMAT_VERSION,
          normalizationVersion: DIDX_NORMALIZATION_VERSION,
          comparisonVersion: DIDX_COMPARISON_VERSION,
          status: 'needs_reindex'
        })
        .onConflictDoNothing({ target: dictionaryIndex.dictionaryId })

      const [record] = await orm
        .select({
          uuid: dictionary.uuid,
          formatVersion: dictionaryIndex.formatVersion,
          normalizationVersion: dictionaryIndex.normalizationVersion,
          comparisonVersion: dictionaryIndex.comparisonVersion,
          sourceFingerprint: dictionaryIndex.sourceFingerprint,
          status: dictionaryIndex.status
        })
        .from(dictionary)
        .innerJoin(dictionaryIndex, eq(dictionaryIndex.dictionaryId, dictionary.id))
        .where(eq(dictionary.id, dictionaryId))
      if (!record) throw new Error(`未找到 DIDX 词典：${dictionaryId}`)

      try {
        const sourceFiles = await this.loadSourceFiles(orm, dictionaryId)
        const mdxPath = getMdxPath(sourceFiles)
        const sourceFingerprint = createSourceFingerprint(await statSourceFiles(sourceFiles))
        const indexPath = getDictionaryIndexPath(this.indexRoot, record.uuid)
        const current =
          !forceRebuild &&
          record.status === 'ready' &&
          record.formatVersion === DIDX_FORMAT_VERSION &&
          record.normalizationVersion === DIDX_NORMALIZATION_VERSION &&
          record.comparisonVersion === DIDX_COMPARISON_VERSION &&
          record.sourceFingerprint === sourceFingerprint

        if (current) {
          try {
            return await openValidatedIndex(indexPath, mdxPath)
          } catch {
            // A missing or damaged formal index is rebuilt through the same path below.
          }
        }

        const updatedAt = new Date().toISOString()
        await orm
          .update(dictionaryIndex)
          .set({ status: 'building', updatedAt })
          .where(eq(dictionaryIndex.dictionaryId, dictionaryId))

        let mdx: Mdx | undefined
        try {
          mdx = Mdx.open(mdxPath)
          const indexStartedAt = performance.now()
          const build = await mdx.buildIndex(indexPath)
          const indexElapsedMs = performance.now() - indexStartedAt
          console.info('[DIDX] index rebuilt', {
            dictionaryId,
            entryCount: build.entryCount.toString(),
            indexElapsedMs: Number(indexElapsedMs.toFixed(2))
          })
          const latestFingerprint = createSourceFingerprint(await statSourceFiles(sourceFiles))
          const builtAt = new Date().toISOString()
          await orm
            .update(dictionaryIndex)
            .set({
              status: 'ready',
              formatVersion: build.formatVersion,
              normalizationVersion: build.normalizationVersion,
              comparisonVersion: DIDX_COMPARISON_VERSION,
              sourceFingerprint: latestFingerprint,
              entryCount: toSafeNumber(build.entryCount, 'entry count'),
              termCount: toSafeNumber(build.termCount, 'term count'),
              fileSize: toSafeNumber(build.fileSize, 'index file size'),
              builtAt,
              updatedAt: builtAt
            })
            .where(eq(dictionaryIndex.dictionaryId, dictionaryId))
          return await openValidatedIndex(indexPath, mdxPath)
        } finally {
          mdx?.close()
        }
      } catch (error) {
        await orm
          .update(dictionaryIndex)
          .set({ status: 'error', updatedAt: new Date().toISOString() })
          .where(eq(dictionaryIndex.dictionaryId, dictionaryId))
        throw error
      }
    } finally {
      connection.close()
    }
  }

  async rebuild(dictionaryId: number): Promise<void> {
    const index = await this.openOrRebuild(dictionaryId, true)
    index.close()
  }

  async importOne(request: DidxImportRequest): Promise<DidxImportResult> {
    const startedAt = performance.now()
    const { db: connection, orm } = openDrizzleDB(this.databasePath)
    let dictionaryId: number | undefined
    let indexRowCreated = false
    let mdx: Mdx | undefined

    try {
      const mdxPath = request.mdxPath
      const sourceFiles = normalizeSourceFiles(mdxPath, request.sourceFiles)
      const mdxSourceFile = sourceFiles.find((file) => file.sourcePath === mdxPath)
      if (!mdxSourceFile) throw new Error(`未找到 MDX 文件：${mdxPath}`)

      const dictionaryName = request.name ?? basename(mdxPath, extname(mdxPath))
      const [dictionaryRow] = await orm
        .insert(dictionary)
        .values({
          uuid: randomUUID(),
          name: dictionaryName,
          dictPath: dirname(mdxPath),
          status: 'importing'
        })
        .returning({ id: dictionary.id, uuid: dictionary.uuid })
      if (!dictionaryRow) throw new Error('创建词典记录失败')
      dictionaryId = dictionaryRow.id

      const sourceStats = await Promise.all(
        sourceFiles.map(async (file) => ({ file, stats: await stat(file.sourcePath) }))
      )
      for (const { file, stats } of sourceStats) {
        const fileType = getDictionaryFileType(file.sourcePath)
        if (!fileType) continue
        await orm.insert(dictionaryFile).values({
          dictionaryId,
          fileName: basename(file.relativePath),
          filePath: file.sourcePath,
          fileType,
          fileSize: toSafeNumber(stats.size, 'file size')
        })
      }

      const indexPath = getDictionaryIndexPath(this.indexRoot, dictionaryRow.uuid)
      await mkdir(dirname(indexPath), { recursive: true })
      await orm.insert(dictionaryIndex).values({
        dictionaryId,
        // 0 means no completed file yet. The Rust writer supplies actual versions.
        formatVersion: 0,
        normalizationVersion: 0,
        comparisonVersion: DIDX_COMPARISON_VERSION,
        sourceFingerprint: createSourceFingerprint(sourceStats),
        status: 'building'
      })
      indexRowCreated = true

      mdx = Mdx.open(mdxSourceFile.sourcePath)
      const metadata = mdx.metadata
      const indexStartedAt = performance.now()
      const build = await mdx.buildIndex(indexPath)
      const indexElapsedMs = performance.now() - indexStartedAt
      console.info('[DIDX] index built', {
        dictionaryId,
        entryCount: build.entryCount.toString(),
        indexElapsedMs: Number(indexElapsedMs.toFixed(2))
      })
      const latestSourceFingerprint = createSourceFingerprint(await statSourceFiles(sourceFiles))
      const builtAt = new Date().toISOString()

      connection.transaction(() => {
        orm
          .update(dictionaryIndex)
          .set({
            status: 'ready',
            formatVersion: build.formatVersion,
            normalizationVersion: build.normalizationVersion,
            sourceFingerprint: latestSourceFingerprint,
            entryCount: toSafeNumber(build.entryCount, 'entry count'),
            termCount: toSafeNumber(build.termCount, 'term count'),
            fileSize: toSafeNumber(build.fileSize, 'index file size'),
            builtAt,
            updatedAt: builtAt
          })
          .where(eq(dictionaryIndex.dictionaryId, dictionaryRow.id))
          .run()

        orm
          .update(dictionary)
          .set({
            name: metadata.title || dictionaryName,
            description: metadata.description || null,
            recordCount: toSafeNumber(build.entryCount, 'record count'),
            status: 'ready',
            updatedAt: builtAt
          })
          .where(eq(dictionary.id, dictionaryRow.id))
          .run()
      })()

      const opened = await openValidatedIndex(indexPath, mdxSourceFile.sourcePath)
      opened.close()

      return {
        dictionaryId,
        dictionaryUuid: dictionaryRow.uuid,
        indexPath,
        entryCount: build.entryCount,
        termCount: build.termCount,
        fileSize: build.fileSize,
        indexElapsedMs,
        elapsedMs: performance.now() - startedAt
      }
    } catch (error) {
      if (dictionaryId !== undefined) {
        const updatedAt = new Date().toISOString()
        if (indexRowCreated) {
          await orm
            .update(dictionaryIndex)
            .set({ status: 'error', updatedAt })
            .where(eq(dictionaryIndex.dictionaryId, dictionaryId))
        }
        await orm
          .update(dictionary)
          .set({ status: 'error', updatedAt })
          .where(eq(dictionary.id, dictionaryId))
      }
      throw error
    } finally {
      mdx?.close()
      connection.close()
    }
  }

  private async loadSourceFiles(
    orm: ReturnType<typeof openDrizzleDB>['orm'],
    dictionaryId: number
  ): Promise<DictionaryImportSourceFile[]> {
    const rows = await orm
      .select({ sourcePath: dictionaryFile.filePath, relativePath: dictionaryFile.fileName })
      .from(dictionaryFile)
      .where(eq(dictionaryFile.dictionaryId, dictionaryId))
    if (rows.length === 0) throw new Error(`词典没有源文件：${dictionaryId}`)
    return rows
  }
}

function normalizeSourceFiles(
  mdxPath: string,
  sourceFiles: readonly DictionaryImportSourceFile[]
): DictionaryImportSourceFile[] {
  const files =
    sourceFiles.length > 0
      ? [...sourceFiles]
      : [{ sourcePath: mdxPath, relativePath: basename(mdxPath) }]
  if (!files.some((file) => file.sourcePath === mdxPath)) {
    throw new Error('sourceFiles 必须包含 mdxPath')
  }
  if (new Set(files.map((file) => file.sourcePath)).size !== files.length) {
    throw new Error('sourceFiles 不能包含重复路径')
  }
  return files
}

function getDictionaryFileType(filePath: string): 'mdx' | 'mdd' | undefined {
  const extension = extname(filePath).toLowerCase()
  return extension === '.mdx' ? 'mdx' : extension === '.mdd' ? 'mdd' : undefined
}

function createSourceFingerprint(
  sourceStats: Array<{ file: DictionaryImportSourceFile; stats: { size: number; mtimeMs: number } }>
): string {
  return JSON.stringify(
    sourceStats
      .map(({ file, stats }) => ({
        path: file.sourcePath,
        relativePath: file.relativePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
  )
}

function statSourceFiles(
  sourceFiles: readonly DictionaryImportSourceFile[]
): Promise<Array<{ file: DictionaryImportSourceFile; stats: { size: number; mtimeMs: number } }>> {
  return Promise.all(
    sourceFiles.map(async (file) => ({ file, stats: await stat(file.sourcePath) }))
  )
}

function getMdxPath(sourceFiles: readonly DictionaryImportSourceFile[]): string {
  const mdxFiles = sourceFiles.filter(
    ({ sourcePath }) => extname(sourcePath).toLowerCase() === '.mdx'
  )
  if (mdxFiles.length !== 1) throw new Error(`DIDX 词典必须有且仅有一个 MDX 源文件`)
  return mdxFiles[0].sourcePath
}

async function openValidatedIndex(indexPath: string, mdxPath: string): Promise<DidxIndex> {
  const index = await DidxIndex.openForMdx(indexPath, mdxPath)
  try {
    await index.validate()
    return index
  } catch (error) {
    index.close()
    throw error
  }
}

function toSafeNumber(value: number | bigint, field: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} 超出 SQLite/JavaScript 安全整数范围：${value}`)
  }
  return number
}
