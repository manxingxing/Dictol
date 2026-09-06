import { stat } from 'node:fs/promises'

import { hashFile } from './file-hash'

export type MdictFileDescriptor = {
  id: number
  filePath: string
  external: boolean
  fileSize: number | null
  lastModified: number | null
  checksum: string | null
}

export type MdictFileValidation =
  | { valid: true; lastModifiedToPersist: number | null }
  | { valid: false; reason: 'missing' | 'changed' }

/**
 * 校验 external 文件。
 *
 * file_size 和 last_modified 都存在且未变化时不读取文件内容；只有元数据变化时
 * 才计算 checksum。缺少旧元数据或 checksum 时沿用旧行为，直接视为可用。
 */
export async function validateMdictFile(file: MdictFileDescriptor): Promise<MdictFileValidation> {
  if (!file.external || !file.checksum || file.fileSize === null || file.lastModified === null) {
    return { valid: true, lastModifiedToPersist: null }
  }

  let fileStats
  try {
    fileStats = await stat(file.filePath, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { valid: false, reason: 'missing' }
    }
    throw error
  }

  if (!fileStats.isFile()) return { valid: false, reason: 'missing' }

  const currentLastModified = Number(fileStats.mtimeMs)
  if (fileStats.size === BigInt(file.fileSize) && currentLastModified === file.lastModified) {
    return { valid: true, lastModifiedToPersist: null }
  }

  if ((await hashFile(file.filePath)) !== file.checksum) {
    return { valid: false, reason: 'changed' }
  }
  return { valid: true, lastModifiedToPersist: currentLastModified }
}
