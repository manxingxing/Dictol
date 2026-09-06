import { and, asc, eq, inArray } from 'drizzle-orm'
import { DictolDatabase } from '../drizzle'
import { DictionaryFile, dictionary, dictionaryFile } from '../schema'

export type { DictionaryFile } from '../schema'

export class DictionaryFileRepository {
  private db: DictolDatabase

  constructor(db: DictolDatabase) {
    this.db = db
  }

  /** 创建词典文件记录。 */
  async create(values: {
    dictionaryId: number
    fileName: string
    filePath: string
    fileType: 'mdx' | 'mdd'
    fileSize: number
    lastModified: number
    checksum: string
  }): Promise<number> {
    const [row] = await this.db
      .insert(dictionaryFile)
      .values(values)
      .returning({ id: dictionaryFile.id })

    if (!row) throw new Error('创建词典文件记录失败')
    return row.id
  }

  /** 更新 MDX/MDD 格式元数据。 */
  async updateFormatMetadata(
    id: number,
    values: { formatVersion: string; isEncrypted: boolean }
  ): Promise<void> {
    await this.db
      .update(dictionaryFile)
      .set({ ...values, updatedAt: new Date().toISOString() })
      .where(eq(dictionaryFile.id, id))
  }

  /** 更新文件的最后修改时间。文件内容校验通过后由上层调用。 */
  async updateLastModified(id: number, lastModified: number): Promise<void> {
    await this.db
      .update(dictionaryFile)
      .set({ lastModified, updatedAt: new Date().toISOString() })
      .where(eq(dictionaryFile.id, id))
  }

  /** 查询某个词典下的所有文件 */
  async listByDictionaryId(dictionaryId: number): Promise<DictionaryFile[]> {
    return this.db
      .select()
      .from(dictionaryFile)
      .where(eq(dictionaryFile.dictionaryId, dictionaryId))
      .orderBy(asc(dictionaryFile.id))
  }

  /** 查询资源加载所需的词典目录和文件信息。 */
  async listResourceFiles(
    dictionaryId: number
  ): Promise<Array<DictionaryFile & { dictPath: string | null; external: boolean }>> {
    return this.db
      .select({
        id: dictionaryFile.id,
        dictionaryId: dictionaryFile.dictionaryId,
        fileName: dictionaryFile.fileName,
        filePath: dictionaryFile.filePath,
        fileType: dictionaryFile.fileType,
        fileSize: dictionaryFile.fileSize,
        lastModified: dictionaryFile.lastModified,
        checksum: dictionaryFile.checksum,
        formatVersion: dictionaryFile.formatVersion,
        isEncrypted: dictionaryFile.isEncrypted,
        createdAt: dictionaryFile.createdAt,
        updatedAt: dictionaryFile.updatedAt,
        dictPath: dictionary.dictPath,
        external: dictionary.external
      })
      .from(dictionaryFile)
      .innerJoin(dictionary, eq(dictionary.id, dictionaryFile.dictionaryId))
      .where(eq(dictionaryFile.dictionaryId, dictionaryId))
      .orderBy(asc(dictionaryFile.fileName), asc(dictionaryFile.id))
  }

  /** 查询某个词典下指定类型的文件 */
  async listByDictionaryIdAndType(
    dictionaryId: number,
    fileType: 'mdx' | 'mdd'
  ): Promise<DictionaryFile[]> {
    return this.db
      .select()
      .from(dictionaryFile)
      .where(
        and(eq(dictionaryFile.dictionaryId, dictionaryId), eq(dictionaryFile.fileType, fileType))
      )
      .orderBy(asc(dictionaryFile.id))
  }

  /** 批量查询指定 MDX 文件的路径。 */
  async listMdxByIds(ids: number[]): Promise<Array<Pick<DictionaryFile, 'id' | 'filePath'>>> {
    if (ids.length === 0) return []

    return this.db
      .select({ id: dictionaryFile.id, filePath: dictionaryFile.filePath })
      .from(dictionaryFile)
      .where(and(eq(dictionaryFile.fileType, 'mdx'), inArray(dictionaryFile.id, ids)))
      .orderBy(asc(dictionaryFile.id))
  }

  /** 根据 ID 查询 */
  async findById(id: number): Promise<DictionaryFile | undefined> {
    const [row] = await this.db
      .select()
      .from(dictionaryFile)
      .where(eq(dictionaryFile.id, id))
      .limit(1)
    return row
  }

  /** 批量删除指定词典下的所有文件 */
  async deleteByDictionaryId(dictionaryId: number): Promise<void> {
    await this.db.delete(dictionaryFile).where(eq(dictionaryFile.dictionaryId, dictionaryId))
  }

  /** 批量删除指定 ID 的文件 */
  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.delete(dictionaryFile).where(inArray(dictionaryFile.id, ids))
  }
}
