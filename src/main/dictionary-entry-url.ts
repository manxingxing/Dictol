import { DICTOL_ASSET_SCHEME, ENTRY_SCHEME } from './entry-assets'
import type { DictionaryLookupRequest } from '../shared/dictionary-navigation'

export const ENTRY_LOOKUP_PATH = '/_dictol-lookup'
export const ENTRY_AGGREGATE_PATH = '/__dictol_aggregate'

export type DictionaryEntryLocation = {
  dictionaryId: number
  term: string
}

export type DictionaryAggregateLocation = {
  term: string
  dictionaryId?: number
}

export type DictionaryResourceLocation = {
  dictionaryId: number
  resourcePath: string
}

export type NativeDictionaryResourceLocation = DictionaryResourceLocation

export function createDictionaryEntryUrl(
  dictionaryId: string | number,
  term: string,
  options: { preview?: boolean; anchor?: string } = {}
): string {
  const numericDictionaryId = parsePositiveSafeInteger(String(dictionaryId))
  if (numericDictionaryId === null) throw new Error('Invalid dictionary ID')
  const normalizedTerm = term.trim()
  if (!normalizedTerm || normalizedTerm.length > 200) throw new Error('Invalid entry term')

  const url = new URL(
    `${ENTRY_SCHEME}://dictionary-${numericDictionaryId}.dictol${ENTRY_LOOKUP_PATH}`
  )
  url.searchParams.set('term', normalizedTerm)
  if (options.preview) url.searchParams.set('preview', '1')
  if (options.anchor) url.hash = options.anchor
  return url.href
}

export function createDictionaryAggregateUrl(
  term: string,
  options: { dictionaryId?: string | number; anchor?: string } = {}
): string {
  const normalizedTerm = term.trim()
  if (!normalizedTerm || normalizedTerm.length > 200) throw new Error('Invalid aggregate term')

  const url = new URL(`${ENTRY_SCHEME}://app.dictol${ENTRY_AGGREGATE_PATH}`)
  url.searchParams.set('term', normalizedTerm)
  if (options.dictionaryId !== undefined) {
    const dictionaryId = parsePositiveSafeInteger(String(options.dictionaryId))
    if (dictionaryId === null) throw new Error('Invalid dictionary ID')
    url.searchParams.set('dictionaryId', String(dictionaryId))
  }
  if (options.anchor) url.hash = options.anchor
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
  const terms = url.searchParams.getAll('term')
  if (
    dictionaryId === null ||
    terms.length !== 1 ||
    Array.from(url.searchParams.keys()).some((key) => key !== 'term' && key !== 'preview') ||
    (url.searchParams.has('preview') &&
      (url.searchParams.getAll('preview').length !== 1 || url.searchParams.get('preview') !== '1'))
  ) {
    return null
  }

  const term = terms[0]?.trim() ?? ''
  return term && term.length <= 200 ? { dictionaryId, term } : null
}

export function parseDictionaryAggregateUrl(value: string): DictionaryAggregateLocation | null {
  const url = parseUrl(value)
  if (!url || url.protocol !== `${ENTRY_SCHEME}:` || url.pathname !== ENTRY_AGGREGATE_PATH) {
    return null
  }

  const terms = url.searchParams.getAll('term')
  const dictionaryIds = url.searchParams.getAll('dictionaryId')
  if (
    terms.length !== 1 ||
    dictionaryIds.length > 1 ||
    Array.from(url.searchParams.keys()).some((key) => key !== 'term' && key !== 'dictionaryId')
  ) {
    return null
  }

  const term = terms[0]?.trim() ?? ''
  if (!term || term.length > 200) return null

  if (dictionaryIds.length === 0) return { term }
  const dictionaryId = parsePositiveSafeInteger(dictionaryIds[0])
  return dictionaryId === null ? null : { term, dictionaryId }
}

export function parseDictionaryEntryNavigation(targetUrl: string): DictionaryLookupRequest | null {
  const url = parseUrl(targetUrl)
  if (!url || url.protocol !== 'entry:') return null

  const match = /^dictionary-(\d+)$/.exec(url.hostname)
  const dictionaryId = match ? parsePositiveSafeInteger(match[1]) : null
  const encodedWord = url.pathname.replace(/^\//, '') + url.search + url.hash
  if (dictionaryId === null || !encodedWord) return null

  let word: string
  try {
    word = decodeURIComponent(encodedWord)
  } catch {
    return null
  }
  if (!word) return null

  return { word, sourceDictionaryId: String(dictionaryId) }
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

export function parseNativeDictionaryResourceLocation(
  value: string,
  expectedScheme: 'sound' | 'audio' | 'file'
): NativeDictionaryResourceLocation | null {
  const url = parseUrl(value)
  if (!url || url.protocol !== `${expectedScheme}:` || url.username || url.password || url.port) {
    return null
  }
  const dictionaryId = parseDictionaryHostname(url.hostname)
  const resourcePath = decodeResourcePath(url.pathname)
  return dictionaryId === null || resourcePath === null ? null : { dictionaryId, resourcePath }
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
  return (
    pathname === ENTRY_LOOKUP_PATH ||
    pathname.startsWith(`${ENTRY_LOOKUP_PATH}/`) ||
    pathname === ENTRY_AGGREGATE_PATH
  )
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
