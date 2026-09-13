import { Mdx } from '@dictol/mdict-native'
import { eq } from 'drizzle-orm'
import { constants } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parentPort, workerData } from 'node:worker_threads'

import type {
  DictionaryImportWorkerFile,
  DictionaryImportWorkerRequest
} from '../shared/dictionary-import'
import { openDrizzleDB } from './db/drizzle'
import { hashFile } from './file-hash'
import { DictionaryFileRepository } from './db/repository/dictionary-file-repository'
import { DictionaryRepository } from './db/repository/dictionary-repository'
import { dictionaryIndex } from './db/schema'

type ImportWorkerMessage =
  { type: 'ready'; name: string; indexElapsedMs: number } | { type: 'error'; error: string }

const input = workerData as DictionaryImportWorkerRequest

void importDictionary(input)
  .catch((error: unknown) => {
    const message: ImportWorkerMessage = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    }
    parentPort?.postMessage(message)
  })
  .finally(() => parentPort?.close())

async function importDictionary(data: DictionaryImportWorkerRequest): Promise<void> {
  const { db: connection, orm } = openDrizzleDB(data.databasePath)
  const dictionaryRepo = new DictionaryRepository(orm)
  const dictionaryFileRepo = new DictionaryFileRepository(orm)
  let mdx: Mdx | undefined

  try {
    let mdxPath: string | undefined
    let mdxFileId: number | undefined

    for (const file of data.sourceFiles) {
      const filePath = await materializeFile(data, file)
      const fileStats = await stat(filePath, { bigint: true })
      if (file.id !== null) {
        await dictionaryFileRepo.updateImportMetadata(file.id, {
          fileSize: toSafeNumber(fileStats.size, 'file size'),
          lastModified: toSafeNumber(fileStats.mtimeMs, 'last modified'),
          checksum: await hashFile(filePath)
        })
      }

      if (extname(file.relativePath).toLowerCase() === '.mdx') {
        if (file.id === null) throw new Error('MDX 文件记录尚未创建')
        mdxPath = filePath
        mdxFileId = file.id
      }
    }

    if (!mdxPath || mdxFileId === undefined) throw new Error('未找到 MDX 文件')

    mdx = Mdx.open(mdxPath)
    const metadata = mdx.metadata
    await dictionaryFileRepo.updateFormatMetadata(mdxFileId, {
      formatVersion: String(metadata.engineVersion),
      isEncrypted: metadata.encrypted !== 0
    })

    const indexStartedAt = performance.now()
    await mkdir(dirname(data.indexPath), { recursive: true })
    const build = await mdx.buildIndex(data.indexPath)
    const indexElapsedMs = performance.now() - indexStartedAt
    const sourceFingerprint = await hashFile(mdxPath)
    const readyName = metadata.title || basename(mdxPath, extname(mdxPath))
    const builtAt = new Date().toISOString()

    await orm
      .update(dictionaryIndex)
      .set({
        status: 'ready',
        formatVersion: build.formatVersion,
        normalizationVersion: build.normalizationVersion,
        comparisonVersion: 1,
        sourceFingerprint,
        entryCount: toSafeNumber(build.entryCount, 'entry count'),
        termCount: toSafeNumber(build.termCount, 'term count'),
        fileSize: toSafeNumber(build.fileSize, 'index file size'),
        builtAt,
        updatedAt: builtAt
      })
      .where(eq(dictionaryIndex.dictionaryId, data.dictionaryId))

    await dictionaryRepo.markReady(data.dictionaryId, {
      name: readyName,
      description: metadata.description || null,
      recordCount: toSafeNumber(build.entryCount, 'record count')
    })
    console.info('[DIDX] index built', {
      dictionaryId: data.dictionaryId,
      dictionaryName: readyName,
      entryCount: build.entryCount.toString(),
      indexElapsedMs: Number(indexElapsedMs.toFixed(2))
    })
    parentPort?.postMessage({
      type: 'ready',
      name: readyName,
      indexElapsedMs
    } satisfies ImportWorkerMessage)
  } catch (error) {
    await dictionaryRepo.markError(data.dictionaryId).catch((statusError) => {
      console.error('Failed to mark dictionary import as errored', statusError)
    })
    await orm
      .update(dictionaryIndex)
      .set({ status: 'error', updatedAt: new Date().toISOString() })
      .where(eq(dictionaryIndex.dictionaryId, data.dictionaryId))
      .catch((statusError) => {
        console.error('Failed to mark dictionary index as errored', statusError)
      })
    throw error
  } finally {
    mdx?.close()
    connection.close()
  }
}

async function materializeFile(
  data: DictionaryImportWorkerRequest,
  file: DictionaryImportWorkerFile
): Promise<string> {
  const targetPath = join(data.targetDirectory, file.relativePath)
  if (data.copyFiles) {
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(file.sourcePath, targetPath, constants.COPYFILE_FICLONE)
    return targetPath
  }
  return file.sourcePath
}

function toSafeNumber(value: number | bigint, field: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} 超出 SQLite/JavaScript 安全整数范围：${value}`)
  }
  return number
}
