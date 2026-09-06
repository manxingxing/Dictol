import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

import { getAppRunTime } from './app-runtime'

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

  const cached = await runtime.resourceCache.read(dictionaryId, resourcePath, mimeType)
  if (cached) {
    console.debug('[DictionaryResource] cache hit', {
      dictionaryId,
      resourcePath,
      byteLength: cached.length
    })
    return { bytes: cached, mimeType, source: 'cache' }
  }

  const extracted = await runtime.mdictResourceManager.loadResource(dictionaryId, resourcePath)
  if (!extracted) {
    console.debug('[DictionaryResource] lookup miss', {
      dictionaryId,
      resourcePath
    })
    return null
  }

  console.debug('[DictionaryResource] MDD hit', {
    dictionaryId,
    resourcePath,
    byteLength: extracted.length
  })

  try {
    await runtime.resourceCache.write(dictionaryId, resourcePath, mimeType, extracted)
  } catch (error) {
    console.warn('Failed to cache dictionary resource', error)
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
      return 'audio/ogg'
    case '.spx':
      return 'audio/x-speex'
    case '.m4a':
      return 'audio/mp4'
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
