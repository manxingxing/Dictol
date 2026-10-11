import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { app, nativeImage } from 'electron'
import type { DictionaryNoteAttachmentItem, DictionaryNoteItem } from '../../shared/dictionary-note'
import type { CreateDictionaryNoteInput, DBService } from '../db-service'

const MAX_CLIPBOARD_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_PIXELS = 30_000_000
const IMAGE_DIRECTORY = 'dictionary-note-images'

function imageRoot(): string {
  return join(app.getPath('userData'), IMAGE_DIRECTORY)
}

// 转换为实际存储路径
function getDictionaryNoteImagePath(storageKey: string): string {
  if (!/^[0-9a-f-]{36}\.png$/i.test(storageKey)) throw new Error('无效的图片存储标识')
  const root = resolve(imageRoot())
  const directory = resolve(root, storageKey.slice(0, 2))
  const path = resolve(directory, storageKey)
  if (dirname(directory) !== root || dirname(path) !== directory) {
    throw new Error('无效的图片存储位置')
  }
  return path
}

// bytes->png
function encodeDictionaryNoteImage(bytes: Uint8Array): {
  png: Buffer
  width: number
  height: number
} {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_CLIPBOARD_BYTES
  ) {
    throw new Error('图片为空或超过 20 MB')
  }

  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  const { width, height } = image.getSize()
  if (image.isEmpty() || width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('无法读取图片，或图片尺寸超过限制')
  }

  const png = image.toPNG()
  if (png.byteLength > MAX_CLIPBOARD_BYTES) throw new Error('图片转换后超过 20 MB')

  return { png, width, height }
}

function describeDictionaryNoteImage(
  id: string,
  png: Buffer,
  width: number,
  height: number
): DictionaryNoteAttachmentItem {
  return {
    id,
    storageKey: `${id}.png`,
    mimeType: 'image/png',
    byteSize: png.byteLength,
    width,
    height
  }
}

// 保存到磁盘
async function saveDictionaryNoteImage(bytes: Uint8Array): Promise<DictionaryNoteAttachmentItem> {
  const { png, width, height } = encodeDictionaryNoteImage(bytes)
  const id = randomUUID()
  const image = describeDictionaryNoteImage(id, png, width, height)
  const path = getDictionaryNoteImagePath(image.storageKey)

  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, png, { flag: 'wx' })
  } catch (error) {
    try {
      await rm(path, { force: true })
    } catch {
      // Preserve the write error; orphan cleanup can remove any partial file.
    }
    throw error
  }

  return image
}

export async function deleteDictionaryNoteImage(storageKey: string): Promise<void> {
  await rm(getDictionaryNoteImagePath(storageKey), { force: true })
}

export async function readDictionaryNoteImage(storageKey: string): Promise<Buffer> {
  return await readFile(getDictionaryNoteImagePath(storageKey))
}

export async function createDictionaryNoteWithImages(
  db: DBService,
  input: Omit<CreateDictionaryNoteInput, 'attachments'> & { imageBytes?: Uint8Array[] }
): Promise<DictionaryNoteItem> {
  const { imageBytes = [], ...noteInput } = input
  if (!Array.isArray(imageBytes) || imageBytes.length > 20) {
    throw new Error('笔记图片数量不能超过 20 张')
  }

  const images: DictionaryNoteAttachmentItem[] = []
  try {
    for (const bytes of imageBytes) images.push(await saveDictionaryNoteImage(bytes))
    return await db.createDictionaryNote({ ...noteInput, attachments: images })
  } catch (error) {
    await Promise.all(
      images.map(async (image) => {
        try {
          // 如果db里没有对应的记录
          if (!(await db.hasDictionaryNoteImage(image.id))) {
            await deleteDictionaryNoteImage(image.storageKey)
          }
        } catch (cleanupError) {
          console.error('Failed to remove an unlinked dictionary note image', cleanupError)
        }
      })
    )
    throw error
  }
}
