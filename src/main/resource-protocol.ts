import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

import { getAppRunTime } from './app-runtime'

const MDD_FILE_CACHE_THRESHOLD = 10n * 1024n

export type LoadedDictionaryResource = {
  bytes: Buffer
  mimeType: string
  source: 'cache' | 'local' | 'mdd'
}

export async function loadDictionaryResource(
  dictionaryId: number,
  resourcePath: string,
  runtime = getAppRunTime()
): Promise<LoadedDictionaryResource | null> {
  const mimeType = getMimeType(resourcePath)
  console.debug('[DictionaryResource] lookup started', {
    dictionaryId,
    resourcePath,
    mimeType
  })

  const directory = await runtime.mdictResourceManager.getResourceDirectory(dictionaryId)

  // Companion files are user-provided and must override extracted MDD data.
  // readFile is intentionally used as the existence check so a hit costs one
  // filesystem read instead of an access/stat call followed by another read.
  const local = await readLocalCompanion(directory, resourcePath)
  if (local) {
    console.debug('[DictionaryResource] local companion hit', {
      dictionaryId,
      resourcePath,
      byteLength: local.length
    })
    return { bytes: local, mimeType, source: 'local' }
  }

  const location = await runtime.mdictResourceManager.findResource(dictionaryId, resourcePath)
  if (!location) {
    console.debug('[DictionaryResource] lookup miss', {
      dictionaryId,
      resourcePath
    })
    return null
  }

  const useFileCache = location.recordEnd - location.recordStart > MDD_FILE_CACHE_THRESHOLD
  if (useFileCache) {
    const cached = await runtime.resourceCache.read(dictionaryId, resourcePath, mimeType)
    if (cached) {
      console.debug('[DictionaryResource] cache hit', {
        dictionaryId,
        resourcePath,
        byteLength: cached.length
      })
      return { bytes: cached, mimeType, source: 'cache' }
    }
  }

  const extracted = await runtime.mdictResourceManager.readResource(dictionaryId, location)
  console.debug('[DictionaryResource] MDD hit', {
    dictionaryId,
    resourcePath,
    byteLength: extracted.length
  })

  if (useFileCache) {
    try {
      await runtime.resourceCache.write(dictionaryId, resourcePath, mimeType, extracted)
    } catch (error) {
      console.warn('Failed to cache dictionary resource', error)
    }
  }
  return { bytes: extracted, mimeType, source: 'mdd' }
}

async function readLocalCompanion(directory: string, resourcePath: string): Promise<Buffer | null> {
  const root = resolve(directory)
  const target = resolve(root, ...resourcePath.split('/'))
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null

  try {
    return await readFile(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function getMimeType(resourcePath: string): string {
  switch (extname(resourcePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.ogg':
    case '.oga':
    case '.opus':
      // .opus 实际是 Ogg 容器内的 Opus，Chromium 通过 Ogg demuxer 解码
      return 'audio/ogg'
    case '.webm':
    case '.weba':
      return 'audio/webm'
    case '.flac':
      return 'audio/flac'
    case '.aac':
      return 'audio/aac'
    case '.m4a':
    case '.m4b':
    case '.m4r':
    case '.mp4':
      return 'audio/mp4'
    case '.spx':
      // Chromium 无 Speex 解码器，保留仅为兼容旧词典链接
      return 'audio/x-speex'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    case '.otf':
      return 'font/otf'
    default:
      return 'application/octet-stream'
  }
}
