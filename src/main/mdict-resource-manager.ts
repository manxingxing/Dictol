import { MddList, Mdx, type DictionaryMetadata } from '@dictol/mdict-native'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { validateMdictFile, type MdictFileDescriptor } from './mdict-file-validator'
import { MdictResourceFiles, type MdictRecordLocator } from './mdict-resource-files'

const CLOSE_RETRY_DELAY_MS = 20
const CLOSE_RETRY_LIMIT = 100
const ENTRY_SEPARATOR = '<hr class="dictol-entry-separator" />'

export type DictionaryResourceFileRecord = MdictFileDescriptor & {
  fileName: string
  fileType: 'mdx' | 'mdd'
  dictPath: string | null
}

export interface MdictResourceDatabase {
  listDictionaryResourceFiles(dictionaryId: number): Promise<DictionaryResourceFileRecord[]>
  updateDictionaryFileLastModified(fileId: number, lastModified: number): Promise<void>
  getDictionaryEntryRecords(entryId: string): Promise<MdictEntryRecord[]>
}

export type MdictResourceInfo = {
  metadata: DictionaryMetadata
  dictionaryFileNames: string[]
}

export type MdictEntryRecord = MdictRecordLocator & {
  id: string
  dictionaryId: string
  word: string
}

export type MdictEntry = Omit<MdictEntryRecord, keyof MdictRecordLocator> & {
  html: string
}

export type MdictResourceErrorCode =
  'dictionary-not-found' | 'file-missing' | 'file-changed' | 'resource-closing' | 'open-failed'

export class MdictResourceError extends Error {
  constructor(
    readonly code: MdictResourceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'MdictResourceError'
  }
}

type DictionaryResourceManifest = {
  directory: string
  files: DictionaryResourceFileRecord[]
  mdx: DictionaryResourceFileRecord
  mddList: DictionaryResourceFileRecord[]
}

/** 按 dictionaryId 管理主进程中的 MDX/MDD 原生资源。 */
export class MdictResourceManager {
  private readonly resources = new Map<number, MdictResourceFiles>()
  private readonly manifests = new Map<number, DictionaryResourceManifest>()
  private readonly opening = new Map<number, Promise<MdictResourceFiles>>()
  private readonly closing = new Set<number>()

  constructor(private readonly db: MdictResourceDatabase) {}

  async getInfo(dictionaryId: number): Promise<MdictResourceInfo> {
    const resource = await this.acquire(dictionaryId)
    const manifest = this.requireManifest(dictionaryId)
    return {
      metadata: resource.metadata,
      dictionaryFileNames: manifest.files.map((file) => file.fileName)
    }
  }

  async getEntry(entryId: string): Promise<MdictEntry | null> {
    const records = await this.db.getDictionaryEntryRecords(entryId)
    const record = records[0]
    if (!record) return null

    const resource = await this.acquire(Number(record.dictionaryId))
    const texts = await resource.readRecords(records)
    return {
      id: record.id,
      dictionaryId: record.dictionaryId,
      word: record.word,
      html: [...new Set(texts)].join(ENTRY_SEPARATOR)
    }
  }

  async loadResource(dictionaryId: number, resourcePath: string): Promise<Buffer | null> {
    const resource = await this.acquire(dictionaryId)
    return resource.loadResource(resourcePath)
  }

  async getResourceDirectory(dictionaryId: number): Promise<string> {
    await this.acquire(dictionaryId)
    return this.requireManifest(dictionaryId).directory
  }

  /** 关闭词典原生资源并移除内存缓存。 */
  async close(dictionaryId: number): Promise<void> {
    this.closing.add(dictionaryId)
    try {
      await this.opening.get(dictionaryId)?.catch(() => undefined)
      const resource = this.resources.get(dictionaryId)
      if (resource) await this.closeResource(resource)
      this.resources.delete(dictionaryId)
      this.manifests.delete(dictionaryId)
    } finally {
      this.closing.delete(dictionaryId)
    }
  }

  dispose(): void {
    for (const resource of this.resources.values()) resource.close()
    this.resources.clear()
    this.manifests.clear()
    this.opening.clear()
    this.closing.clear()
  }

  private async acquire(dictionaryId: number): Promise<MdictResourceFiles> {
    if (this.closing.has(dictionaryId)) {
      throw new MdictResourceError('resource-closing', '词典资源正在关闭')
    }

    const cached = this.resources.get(dictionaryId)
    if (cached) return cached

    let pending = this.opening.get(dictionaryId)
    if (!pending) {
      pending = this.open(dictionaryId)
      this.opening.set(dictionaryId, pending)
    }

    try {
      return await pending
    } finally {
      if (this.opening.get(dictionaryId) === pending) this.opening.delete(dictionaryId)
    }
  }

  private async open(dictionaryId: number): Promise<MdictResourceFiles> {
    try {
      const manifest = await this.loadManifest(dictionaryId)
      await this.validateFiles(manifest.files)

      const mdx = Mdx.open(manifest.mdx.filePath)
      let mddList: MddList | null = null
      try {
        mddList =
          manifest.mddList.length > 0
            ? MddList.open(manifest.mddList.map((file) => file.filePath))
            : null
      } catch (error) {
        mdx.close()
        throw error
      }

      const resource = new MdictResourceFiles(dictionaryId, mdx, mddList)
      this.resources.set(dictionaryId, resource)
      this.manifests.set(dictionaryId, manifest)
      return resource
    } catch (error) {
      this.manifests.delete(dictionaryId)
      if (error instanceof MdictResourceError) throw error
      throw new MdictResourceError('open-failed', '无法打开词典资源', { cause: error })
    }
  }

  private async loadManifest(dictionaryId: number): Promise<DictionaryResourceManifest> {
    const files = await this.db.listDictionaryResourceFiles(dictionaryId)
    const mdx = files.find((file) => file.fileType === 'mdx')
    if (!mdx) {
      throw new MdictResourceError('dictionary-not-found', '词典 MDX 文件不存在')
    }

    const mddList = files
      .filter((file) => file.fileType === 'mdd')
      .sort((left, right) => mddOrder(left.fileName) - mddOrder(right.fileName))

    return {
      files,
      mdx,
      mddList,
      directory: mdx.dictPath ?? dirname(mdx.filePath)
    }
  }

  private async validateFiles(files: readonly DictionaryResourceFileRecord[]): Promise<void> {
    const validations = await Promise.all(files.map((file) => validateMdictFile(file)))
    for (const [index, file] of files.entries()) {
      const validation = validations[index]!
      if (!validation.valid) {
        const code = validation.reason === 'missing' ? 'file-missing' : 'file-changed'
        throw new MdictResourceError(code, `词典文件不存在或已被修改：${file.filePath}`)
      }
    }

    await Promise.all(
      files.map((file, index) => {
        const validation = validations[index]!
        if (!validation.valid || validation.lastModifiedToPersist === null) {
          return Promise.resolve()
        }
        return this.db.updateDictionaryFileLastModified(file.id, validation.lastModifiedToPersist)
      })
    )
  }

  private requireManifest(dictionaryId: number): DictionaryResourceManifest {
    const manifest = this.manifests.get(dictionaryId)
    if (!manifest) throw new Error('词典资源 manifest 尚未加载')
    return manifest
  }

  private async closeResource(resource: MdictResourceFiles): Promise<void> {
    for (let attempt = 0; attempt <= CLOSE_RETRY_LIMIT; attempt += 1) {
      if (resource.close()) return
      if (attempt < CLOSE_RETRY_LIMIT) await delay(CLOSE_RETRY_DELAY_MS)
    }
    throw new Error('词典文件仍有读取任务未结束，无法安全关闭')
  }
}

function mddOrder(fileName: string): number {
  const part = /\.(\d+)\.mdd$/i.exec(fileName)?.[1]
  return part === undefined ? 0 : Number(part) + 1
}
