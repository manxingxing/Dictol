import { app, protocol, session, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getAppRunTime, type AppRuntime } from './app-runtime'
import type { DBService } from './db-service'
import {
  parseDictionaryEntryResourceUrl,
  parseDictionaryEntryUrl,
  parseDictionaryAssetUrl,
  parseDictionaryIdFromReferrer,
  parseNativeDictionaryResourcePath
} from './dictionary-entry-url'
import { createEntryDocument } from './entry-document'
import {
  DICTIONARY_SESSION_PARTITION,
  DICTOL_ASSET_SCHEME,
  ENTRY_CONTEXT_MENU_URL,
  ENTRY_GLOBAL_STYLE_URL,
  ENTRY_BASE_URL,
  ENTRY_SCHEME
} from './entry-assets'
import { loadDictionaryResource } from './resource-protocol'

const AUDIO_SCHEME = 'audio'
const SOUND_SCHEME = 'sound'
const FILE_SCHEME = 'file'
const DICTIONARY_ID_HEADER = 'x-dictol-dictionary-id'
const STATIC_RESOURCE_CACHE_CONTROL = 'public, max-age=3600'

const ENTRY_ASSETS = new Map([
  [ENTRY_BASE_URL, { fileName: 'entry-base.js', mimeType: 'text/javascript; charset=utf-8' }],
  [
    ENTRY_CONTEXT_MENU_URL,
    { fileName: 'entry-context-menu.js', mimeType: 'text/javascript; charset=utf-8' }
  ],
  [
    ENTRY_GLOBAL_STYLE_URL,
    { fileName: 'dictionary-entry.css', mimeType: 'text/css; charset=utf-8' }
  ]
])

const entryAssetSources = new Map<string, Promise<Buffer>>()
let registered = false

export function registerResourceSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ENTRY_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    },
    {
      scheme: DICTOL_ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    },
    ...[AUDIO_SCHEME, SOUND_SCHEME].map((scheme) => ({
      scheme,
      privileges: {
        secure: true,
        bypassCSP: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }))
  ])
}

export function registerResourceProtocolHandlers(
  runtime = getAppRunTime(),
  dictionarySession = session.fromPartition(DICTIONARY_SESSION_PARTITION)
): DictionaryResourceProtocolHandlers {
  if (registered) throw new Error('Dictionary resource protocol handlers are already registered')
  registered = true

  const handlers = new DictionaryResourceProtocolHandlers(runtime, dictionarySession)
  handlers.register()
  return handlers
}

export class DictionaryResourceProtocolHandlers {
  private readonly dictionaryIdsByWebContents = new Map<number, number>()

  constructor(
    private readonly runtime: AppRuntime,
    private readonly dictionarySession: Session
  ) {}

  register(): void {
    this.registerRequestContextInterception()
    this.registerDictionaryViewProtocolHanders()
    this.registerAssetsHandlers()
  }

  private registerAssetsHandlers(): void {
    session.defaultSession.protocol.handle(DICTOL_ASSET_SCHEME, (request) =>
      this.handleDictionaryAssetProtocol(request)
    )
  }

  private registerDictionaryViewProtocolHanders(): void {
    this.dictionarySession.protocol.handle(ENTRY_SCHEME, (request) =>
      this.handleEntryProtocol(request)
    )
    this.dictionarySession.protocol.handle(SOUND_SCHEME, (request) =>
      this.handleNativeResourceProtocol(request, SOUND_SCHEME)
    )
    this.dictionarySession.protocol.handle(AUDIO_SCHEME, (request) =>
      this.handleNativeResourceProtocol(request, AUDIO_SCHEME)
    )
    this.dictionarySession.protocol.handle(FILE_SCHEME, (request) =>
      this.handleNativeResourceProtocol(request, FILE_SCHEME)
    )
  }

  private registerRequestContextInterception(): void {
    this.dictionarySession.webRequest.onBeforeRequest((details, callback) => {
      if (details.resourceType === 'mainFrame' && details.webContentsId !== undefined) {
        const entry = parseDictionaryEntryUrl(details.url)
        if (entry) this.dictionaryIdsByWebContents.set(details.webContentsId, entry.dictionaryId)
        else this.dictionaryIdsByWebContents.delete(details.webContentsId)
      }
      callback({})
    })

    this.dictionarySession.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders = { ...details.requestHeaders }
      for (const name of Object.keys(requestHeaders)) {
        if (name.toLowerCase() === DICTIONARY_ID_HEADER) delete requestHeaders[name]
      }

      if (isNativeDictionaryResourceUrl(details.url)) {
        const dictionaryId =
          details.webContentsId === undefined
            ? undefined
            : this.dictionaryIdsByWebContents.get(details.webContentsId)
        if (dictionaryId !== undefined) {
          requestHeaders[DICTIONARY_ID_HEADER] = String(dictionaryId)
        }
      }

      callback({ requestHeaders })
    })
  }

  private async handleEntryProtocol(request: Request): Promise<Response> {
    const methodError = validateMethod(request)
    if (methodError) return methodError

    try {
      // 注入的全局 js, css 文件，
      const entryAsset = ENTRY_ASSETS.get(request.url)
      if (entryAsset) {
        const bytes = await loadEntryAssetSource(entryAsset.fileName)
        return bytesResponse(request, bytes, entryAsset.mimeType, 'no-cache')
      }

      const entry = parseDictionaryEntryUrl(request.url)
      if (entry) return this.loadEntryDocument(request, entry.dictionaryId, entry.entryId)

      // mdd资源文件
      const resource = parseDictionaryEntryResourceUrl(request.url)
      if (resource) {
        return this.loadResource(request, resource.dictionaryId, resource.resourcePath)
      }

      return textResponse('Invalid dictol-entry URL', 400)
    } catch (error) {
      console.error('Failed to handle dictol-entry request', { url: request.url, error })
      return textResponse('Failed to load dictionary content', 500)
    }
  }

  private async handleDictionaryAssetProtocol(request: Request): Promise<Response> {
    const methodError = validateMethod(request)
    if (methodError) return methodError

    const location = parseDictionaryAssetUrl(request.url)
    if (!location) return textResponse('Invalid dictionary asset URL', 400)

    // 获取 dict path
    try {
      const icon = await requireDBService(this.runtime).getDictionaryIconResource(
        String(location.dictionaryId),
        location.resourcePath
      )
      return icon
        ? bytesResponse(request, icon.bytes, icon.mimeType, STATIC_RESOURCE_CACHE_CONTROL)
        : textResponse('Dictionary icon not found', 404)
    } catch (error) {
      console.error('Failed to handle dictionary asset request', { url: request.url, error })
      return textResponse('Failed to load dictionary icon', 500)
    }
  }

  private async handleNativeResourceProtocol(
    request: Request,
    scheme: 'sound' | 'audio' | 'file'
  ): Promise<Response> {
    const methodError = validateMethod(request)
    if (methodError) return methodError

    try {
      const referrerDictionaryId = parseDictionaryIdFromReferrer(request.referrer)
      const contextDictionaryId = parseDictionaryIdHeader(request.headers.get(DICTIONARY_ID_HEADER))
      if (
        referrerDictionaryId !== null &&
        contextDictionaryId !== null &&
        referrerDictionaryId !== contextDictionaryId
      ) {
        return textResponse('Dictionary resource context mismatch', 400)
      }
      const dictionaryId = referrerDictionaryId ?? contextDictionaryId
      const resourcePath = parseNativeDictionaryResourcePath(request.url, scheme)
      if (dictionaryId === null || !resourcePath) {
        return textResponse('Invalid dictionary resource request', 400)
      }

      return this.loadResource(request, dictionaryId, resourcePath)
    } catch (error) {
      console.error('Failed to handle dictionary resource request', {
        url: request.url,
        referrer: request.referrer,
        error
      })
      return textResponse('Failed to load dictionary resource', 500)
    }
  }

  private async loadEntryDocument(
    request: Request,
    dictionaryId: number,
    entryId: string
  ): Promise<Response> {
    const startedAt = performance.now()
    const dictionary = await requireDBService(this.runtime).getDictionary(String(dictionaryId))
    if (!dictionary) return textResponse('Dictionary not found', 404)

    const entry = await this.runtime.mdictResourceManager.getEntry(entryId)
    if (!entry) return textResponse('Entry not found', 404)

    if (entry.dictionaryId !== String(dictionaryId)) {
      return textResponse('Dictionary mismatch', 404)
    }

    const isPreview = new URL(request.url).searchParams.get('preview') === '1'
    const response = stringResponse(
      request,
      createEntryDocument(entry.html, entry.dictionaryId, dictionary.customCss, {
        includeContextMenu: !isPreview,
        includeCustomCss: !isPreview
      }),
      'text/html; charset=utf-8'
    )
    console.debug('[DictionaryEntry] load document', {
      dictionaryId,
      dictionaryName: dictionary.name,
      entryId,
      htmlBytes: Buffer.byteLength(entry.html, 'utf8'),
      takeMs: performance.now() - startedAt
    })
    return response
  }

  private async loadResource(
    request: Request,
    dictionaryId: number,
    resourcePath: string
  ): Promise<Response> {
    const resource = await loadDictionaryResource(dictionaryId, resourcePath, this.runtime)
    return resource
      ? bytesResponse(request, resource.bytes, resource.mimeType, STATIC_RESOURCE_CACHE_CONTROL)
      : textResponse('Resource not found', 404)
  }
}

async function loadEntryAssetSource(fileName: string): Promise<Buffer> {
  let source = entryAssetSources.get(fileName)
  if (!source) {
    source = readFirstAvailableFile([
      join(app.getAppPath(), 'resources', fileName),
      join(app.getAppPath(), '..', 'resources', fileName)
    ])
    entryAssetSources.set(fileName, source)
  }

  try {
    return await source
  } catch (error) {
    entryAssetSources.delete(fileName)
    throw error
  }
}

async function readFirstAvailableFile(paths: string[]): Promise<Buffer> {
  for (const path of paths) {
    try {
      return await readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error(`Entry asset not found in: ${paths.join(', ')}`)
}

function validateMethod(request: Request): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null
  return new Response('Method not allowed', {
    status: 405,
    headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }
  })
}

function stringResponse(request: Request, body: string, contentType: string): Response {
  return bytesResponse(request, Buffer.from(body), contentType, 'no-store')
}

function bytesResponse(
  request: Request,
  bytes: Buffer,
  contentType: string,
  cacheControl: string
): Response {
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'access-control-allow-origin': '*',
    'cache-control': cacheControl,
    'content-type': contentType,
    'x-content-type-options': 'nosniff'
  })
  const range = parseRange(request.headers.get('range'), bytes.length)

  if (range === 'invalid') {
    headers.set('content-range', `bytes */${bytes.length}`)
    return new Response(request.method === 'HEAD' ? null : 'Requested range not satisfiable', {
      status: 416,
      headers
    })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, bytes.length - 1)
  const body = bytes.subarray(start, end + 1)
  headers.set('content-length', String(body.length))
  if (range) headers.set('content-range', `bytes ${start}-${end}/${bytes.length}`)

  return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), {
    status: range ? 206 : 200,
    headers
  })
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff'
    }
  })
}

function parseRange(
  value: string | null,
  size: number
): { start: number; end: number } | 'invalid' | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size <= 0 || (!match[1] && !match[2])) return 'invalid'

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid'
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return 'invalid'
  }

  return { start, end: Math.min(requestedEnd, size - 1) }
}

function requireDBService(runtime: AppRuntime): DBService {
  if (!runtime.dbService) throw new Error('资源协议启动前必须初始化 DBService')
  return runtime.dbService
}

function isNativeDictionaryResourceUrl(value: string): boolean {
  try {
    const protocolName = new URL(value).protocol
    return (
      protocolName === `${SOUND_SCHEME}:` ||
      protocolName === `${AUDIO_SCHEME}:` ||
      protocolName === `${FILE_SCHEME}:`
    )
  } catch {
    return false
  }
}

function parseDictionaryIdHeader(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  const dictionaryId = Number(value)
  return Number.isSafeInteger(dictionaryId) ? dictionaryId : null
}
