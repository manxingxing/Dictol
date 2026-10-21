import * as adblock from 'adblock-rs'
import { app, type OnBeforeRequestListenerDetails, type Session } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILTER_LISTS = [
  { name: '主流广告平台', fileName: 'easylist/easylist.txt' },
  { name: '中国主流广告平台', fileName: 'easylist/easylist-china.txt' }
] as const

const REQUEST_FILTER = {
  urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']
}

type FilterList = (typeof FILTER_LISTS)[number]

/**
 * Owns the native ad-block engine and the Electron listeners that use it.
 *
 * The service is deliberately attached only to the embedded browser session.
 * The application window, dictionary view, and other renderer surfaces keep
 * their normal network behaviour.
 */
export class AdBlockService {
  private engine: adblock.Engine | undefined
  private readonly attachedSessions = new Set<Session>()

  initialize(): void {
    if (this.engine) return

    const filterSet = new adblock.FilterSet(false)
    for (const list of FILTER_LISTS) {
      const rules = readFilterList(list)
      filterSet.addFilters(rules, { rule_types: adblock.RuleTypes.NETWORK_ONLY })
    }

    this.engine = new adblock.Engine(filterSet)
  }

  attach(session: Session): void {
    if (this.attachedSessions.has(session)) return
    if (!this.engine) throw new Error('AdBlockService 尚未初始化')

    session.webRequest.onBeforeRequest(REQUEST_FILTER, (details, callback) => {
      callback({ cancel: this.shouldBlock(details) })
    })
    this.attachedSessions.add(session)
  }

  dispose(): void {
    for (const session of this.attachedSessions) {
      session.webRequest.onBeforeRequest(null)
    }
    this.attachedSessions.clear()
    this.engine = undefined
  }

  private shouldBlock(details: OnBeforeRequestListenerDetails): boolean {
    const engine = this.engine
    if (!engine) return false

    const sourceUrl =
      details.frame?.url ||
      details.frame?.top?.url ||
      details.referrer ||
      details.webContents?.getURL() ||
      ''
    const requestType = toAdBlockRequestType(details.resourceType)

    try {
      return engine.check(details.url, sourceUrl, requestType, details.method)
    } catch (error) {
      // A malformed or unsupported request must fail open. It should never
      // prevent the embedded browser from loading a page.
      console.warn('Ad-block request matching failed; allowing request', {
        url: details.url,
        requestType,
        error
      })
      return false
    }
  }
}

function readFilterList(list: FilterList): string {
  const candidates = [
    join(app.getAppPath(), 'resources', list.fileName),
    join(process.resourcesPath, 'app.asar.unpacked', 'resources', list.fileName),
    join(process.resourcesPath, 'resources', list.fileName)
  ]

  for (const filePath of candidates) {
    try {
      return readFileSync(filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  throw new Error(`广告过滤规则不存在：${list.name}（${candidates.join(', ')}）`)
}

function toAdBlockRequestType(
  resourceType: OnBeforeRequestListenerDetails['resourceType']
): string {
  switch (resourceType) {
    case 'mainFrame':
      return 'main_frame'
    case 'subFrame':
      return 'sub_frame'
    case 'webSocket':
      return 'websocket'
    case 'cspReport':
      return 'csp_report'
    default:
      return resourceType
  }
}
