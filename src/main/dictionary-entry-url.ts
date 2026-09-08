import { DICTOL_ASSET_SCHEME, ENTRY_SCHEME } from './entry-assets'

export const ENTRY_LOOKUP_PATH = '/_dictol-lookup'

export type DictionaryEntryLocation = {
  dictionaryId: number
  entryId: string
}

export type DictionaryResourceLocation = {
  dictionaryId: number
  resourcePath: string
}

export function createDictionaryEntryUrl(
  dictionaryId: string | number,
  entryId: string,
  options: { preview?: boolean } = {}
): string {
  const numericDictionaryId = parsePositiveSafeInteger(String(dictionaryId))
  const numericEntryId = parsePositiveSafeInteger(entryId)
  if (numericDictionaryId === null) throw new Error('Invalid dictionary ID')
  if (numericEntryId === null) throw new Error('Invalid entry ID')

  const url = new URL(
    `${ENTRY_SCHEME}://dictionary-${numericDictionaryId}.dictol${ENTRY_LOOKUP_PATH}`
  )
  url.searchParams.set('entryId', String(numericEntryId))
  if (options.preview) url.searchParams.set('preview', '1')
  return url.href
}

export function createDictionaryAssetUrl(
  dictionaryId: string | number,
  resourcePath: string
): string {
  const numericDictionaryId = parsePositiveSafeInteger(String(dictionaryId))
  const normalizedPath = resourcePath.replaceAll('\\', '/')
  const pathParts = normalizedPath.split('/').filter(Boolean)
  if (
    numericDictionaryId === null ||
    normalizedPath.startsWith('/') ||
    pathParts.length === 0 ||
    pathParts.some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Invalid dictionary asset path')
  }

  const url = new URL(`${DICTOL_ASSET_SCHEME}://dictionary-${numericDictionaryId}.dictol/`)
  url.pathname = `/${pathParts.map((part) => encodeURIComponent(part)).join('/')}`
  return url.href
}

export function parseDictionaryAssetUrl(value: string): DictionaryResourceLocation | null {
  const url = parseUrl(value)
  if (!url || url.protocol !== `${DICTOL_ASSET_SCHEME}:`) return null

  const dictionaryId = parseDictionaryHostname(url.hostname)
  const resourcePath = decodeResourcePath(url.pathname)
  return dictionaryId === null || resourcePath === null ? null : { dictionaryId, resourcePath }
}

export function parseDictionaryEntryUrl(value: string): DictionaryEntryLocation | null {
  const url = parseUrl(value)
  if (!url || url.protocol !== `${ENTRY_SCHEME}:` || url.pathname !== ENTRY_LOOKUP_PATH) {
    return null
  }

  const dictionaryId = parseDictionaryHostname(url.hostname)
  const entryIds = url.searchParams.getAll('entryId')
  if (
    dictionaryId === null ||
    entryIds.length !== 1 ||
    Array.from(url.searchParams.keys()).some((key) => key !== 'entryId' && key !== 'preview') ||
    (url.searchParams.has('preview') &&
      (url.searchParams.getAll('preview').length !== 1 || url.searchParams.get('preview') !== '1'))
  ) {
    return null
  }

  const entryId = parsePositiveSafeInteger(entryIds[0])
  return entryId === null ? null : { dictionaryId, entryId: String(entryId) }
}

export function parseDictionaryEntryResourceUrl(value: string): DictionaryResourceLocation | null {
  const url = parseUrl(value)
  if (!url || url.protocol !== `${ENTRY_SCHEME}:`) return null

  const dictionaryId = parseDictionaryHostname(url.hostname)
  if (dictionaryId === null || isReservedLookupPath(url.pathname)) return null

  const resourcePath = decodeResourcePath(url.pathname)
  return resourcePath ? { dictionaryId, resourcePath } : null
}

export function parseDictionaryIdFromReferrer(value: string): number | null {
  const url = parseUrl(value)
  if (!url || url.protocol !== `${ENTRY_SCHEME}:`) return null
  return parseDictionaryHostname(url.hostname)
}

export function parseNativeDictionaryResourcePath(
  value: string,
  expectedScheme: 'sound' | 'audio' | 'file'
): string | null {
  const url = parseUrl(value)
  if (!url || url.protocol !== `${expectedScheme}:` || url.username || url.password || url.port) {
    return null
  }

  const authority = url.hostname ? `/${url.hostname}` : ''
  return decodeResourcePath(`${authority}${url.pathname}`)
}

function parseDictionaryHostname(hostname: string): number | null {
  const match = /^dictionary-(\d+)\.dictol$/.exec(hostname)
  return match ? parsePositiveSafeInteger(match[1]) : null
}

function parsePositiveSafeInteger(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isReservedLookupPath(pathname: string): boolean {
  return pathname === ENTRY_LOOKUP_PATH || pathname.startsWith(`${ENTRY_LOOKUP_PATH}/`)
}

function decodeResourcePath(pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  if (
    decoded.includes('\\') ||
    Array.from(decoded).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    }) ||
    decoded.split('/').some((part) => part === '.' || part === '..')
  ) {
    return null
  }

  const resourcePath = decoded.split('/').filter(Boolean).join('/')
  return resourcePath || null
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
