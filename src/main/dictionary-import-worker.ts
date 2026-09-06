import { Mdx } from '@dictol/mdict-native'
import { constants } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

import type { DictionaryImportSourceFile } from '../shared/dictionary-import'
import { openDrizzleDB } from './db/drizzle'
import { hashFile } from './file-hash'
import { DictionaryEntryRepository } from './db/repository/dictionary-entry-repository'
import { DictionaryFileRepository } from './db/repository/dictionary-file-repository'
import { DictionaryRepository } from './db/repository/dictionary-repository'

const IMPORT_BATCH_SIZE = 2_000

type ImportWorkerData = {
  databasePath: string
  mdxPath: string
  sourceFiles: DictionaryImportSourceFile[]
  copyFiles: boolean
  userDataPath: string
  targetDirectoryName: string
}

type ImportedDictionary = {
  id: string
  name: string
  status: 'importing'
  directory: string
  files: Array<{ id: string; name: string; type: 'mdx' | 'mdd' }>
}

const input = workerData as ImportWorkerData

void importDictionary(input)
  .catch((error: unknown) => {
    parentPort?.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  })
  .finally(() => parentPort?.close())

async function importDictionary(data: ImportWorkerData): Promise<void> {
  const { db: connection, orm } = openDrizzleDB(data.databasePath)
  const dictionaryRepo = new DictionaryRepository(orm)
  const dictionaryFileRepo = new DictionaryFileRepository(orm)
  const dictionaryEntryRepo = new DictionaryEntryRepository(orm)
  const selectedName = basename(data.mdxPath)
  const targetDirectory = data.copyFiles
    ? join(data.userDataPath, 'dictionaries', data.targetDirectoryName)
    : dirname(data.mdxPath)
  const sourceFiles = data.sourceFiles
  let dictionaryId: number | undefined

  try {
    if (data.copyFiles) await mkdir(targetDirectory, { recursive: true })
    dictionaryId = await dictionaryRepo.createImporting(
      basename(selectedName, extname(selectedName)),
      targetDirectory,
      !data.copyFiles
    )
    let mdxFileId: number | undefined
    let mdxTargetPath: string | undefined
    const importedFiles: ImportedDictionary['files'] = []

    for (const { sourcePath, relativePath } of sourceFiles) {
      const fileName = basename(relativePath)
      const targetPath = join(targetDirectory, relativePath)
      const filePath = data.copyFiles ? targetPath : sourcePath
      if (data.copyFiles) {
        await mkdir(dirname(targetPath), { recursive: true })
        await copyFile(sourcePath, targetPath, constants.COPYFILE_FICLONE)
      }
      const extension = extname(fileName).toLowerCase()
      const fileType = extension === '.mdx' ? 'mdx' : extension === '.mdd' ? 'mdd' : undefined
      if (!fileType) continue
      const fileStats = await stat(filePath, { bigint: true })

      const fileId = await dictionaryFileRepo.create({
        dictionaryId,
        fileName,
        filePath,
        fileType,
        fileSize: toSafeNumber(fileStats.size, 'file size'),
        lastModified: toSafeNumber(fileStats.mtimeMs, 'last modified'),
        checksum: await hashFile(filePath)
      })
      importedFiles.push({ id: String(fileId), name: fileName, type: fileType })
      if (fileType === 'mdx') {
        mdxFileId = fileId
        mdxTargetPath = filePath
      }
    }

    if (dictionaryId === undefined || mdxFileId === undefined || mdxTargetPath === undefined) {
      throw new Error('未找到 MDX 文件')
    }
    const importedDictionaryId = dictionaryId
    parentPort?.postMessage({
      type: 'created',
      value: {
        id: String(importedDictionaryId),
        name: basename(selectedName, extname(selectedName)),
        status: 'importing',
        directory: targetDirectory,
        files: importedFiles
      } satisfies ImportedDictionary
    })

    const mdx = Mdx.open(mdxTargetPath)
    const metadata = mdx.metadata
    const scanner = mdx.keys()
    await dictionaryFileRepo.updateFormatMetadata(mdxFileId, {
      formatVersion: String(metadata.engineVersion),
      isEncrypted: metadata.encrypted !== 0
    })

    let importedEntries = 0n
    let batchNumber = 0
    while (true) {
      const batch = await scanner.nextBatch(IMPORT_BATCH_SIZE)
      batchNumber += 1
      if (batch.entries.length > 0) {
        try {
          await dictionaryEntryRepo.insertBatch(
            batch.entries.map((entry) => ({
              dictionaryId: importedDictionaryId,
              dictionaryFileId: mdxFileId,
              word: entry.keyText,
              normalizedWord: entry.keyText.toLowerCase(),
              recordStartOffset: toSafeNumber(entry.recordStart, 'record start offset'),
              recordEndOffset: toSafeNumber(entry.recordEnd, 'record end offset')
            }))
          )
        } catch (error) {
          const firstWord = batch.entries[0]?.keyText ?? ''
          const lastWord = batch.entries.at(-1)?.keyText ?? ''
          throw new Error(
            `第 ${batchNumber} 批词条写入失败（已成功 ${importedEntries} 条，本批 ${batch.entries.length} 条，范围 ${JSON.stringify(firstWord)}–${JSON.stringify(lastWord)}）`,
            { cause: error }
          )
        }
        importedEntries += BigInt(batch.entries.length)
      }
      if (batch.done) break
    }

    if (importedEntries !== metadata.entryCount) {
      throw new Error(
        `词条数量不一致：Header 声明 ${metadata.entryCount}，实际导入 ${importedEntries}`
      )
    }

    const readyName = metadata.title || basename(selectedName, extname(selectedName))
    await dictionaryRepo.markReady(importedDictionaryId, {
      name: readyName,
      description: metadata.description || null,
      recordCount: toSafeNumber(metadata.entryCount, 'record count')
    })
    parentPort?.postMessage({ type: 'ready', name: readyName })
  } catch (error) {
    if (dictionaryId !== undefined) {
      try {
        await dictionaryRepo.markError(dictionaryId)
      } catch (statusError) {
        console.error('Failed to mark dictionary import as errored', statusError)
      }
    }
    throw error
  } finally {
    connection.close()
  }
}

function toSafeNumber(value: number | bigint, field: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} 超出 SQLite/JavaScript 安全整数范围：${value}`)
  }
  return number
}
