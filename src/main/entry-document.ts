import { defaultTreeAdapter, parse, serialize } from 'parse5'
import {
  ENTRY_AGGREGATION_LAYOUT_URL,
  ENTRY_BASE_URL,
  ENTRY_CONTEXT_MENU_URL,
  ENTRY_GLOBAL_STYLE_URL
} from './entry-assets'
import { findChildNode } from './html-rewritter'

export function createEntryDocument(
  html: string,
  dictionaryId: string,
  customCss = '',
  options: {
    includeActiveDictionary?: boolean
    includeContextMenu?: boolean
    includeCustomCss?: boolean
  } = {}
): string {
  const contentSecurityPolicy = [
    "default-src 'none'",
    "style-src 'unsafe-inline' data: blob: dictol-entry: file: http: https:",
    'img-src data: blob: dictol-entry: file: http: https:',
    'media-src data: blob: dictol-entry: sound: audio: file: http: https:',
    "script-src 'unsafe-inline' 'unsafe-eval' data: blob: dictol-entry: file: http: https:",
    'font-src data: blob: dictol-entry: file: http: https:',
    'connect-src blob: dictol-entry: sound: audio: file: http: https: ws: wss:',
    "base-uri 'none'",
    "object-src 'none'"
  ].join('; ')
  const document = parse(html)
  const htmlElement = findChildNode(document, ['html'])!
  const head = findChildNode(htmlElement, ['head'])!
  const createHeadElement = (tagName: string, attrs: { name: string; value: string }[]) =>
    defaultTreeAdapter.createElement(tagName, head.namespaceURI, attrs)

  const firstChild = head.childNodes[0]
  for (const meta of [
    createHeadElement('meta', [
      { name: 'name', value: 'color-scheme' },
      { name: 'content', value: 'light dark' }
    ]),
    createHeadElement('meta', [
      { name: 'name', value: 'dictol-dictionary-id' },
      { name: 'content', value: dictionaryId }
    ]),
    createHeadElement('meta', [
      { name: 'name', value: 'dictol-entry-mode' },
      { name: 'content', value: dictionaryId === 'aggregate' ? 'aggregate' : 'single' }
    ]),
    createHeadElement('meta', [
      { name: 'http-equiv', value: 'Content-Security-Policy' },
      { name: 'content', value: contentSecurityPolicy }
    ])
  ]) {
    if (firstChild) defaultTreeAdapter.insertBefore(head, meta, firstChild)
    else defaultTreeAdapter.appendChild(head, meta)
  }

  defaultTreeAdapter.appendChild(
    head,
    createHeadElement('link', [
      { name: 'id', value: 'dictol-entry-style' },
      { name: 'rel', value: 'stylesheet' },
      { name: 'href', value: ENTRY_GLOBAL_STYLE_URL }
    ])
  )
  if (options.includeCustomCss !== false && customCss) {
    const style = createHeadElement('style', [{ name: 'id', value: 'dictol-custom-style' }])
    defaultTreeAdapter.appendChild(
      style,
      defaultTreeAdapter.createTextNode(escapeStyleContent(customCss))
    )
    defaultTreeAdapter.appendChild(head, style)
  }
  for (const src of [
    ENTRY_BASE_URL,
    options.includeContextMenu === false ? null : ENTRY_CONTEXT_MENU_URL,
    options.includeActiveDictionary ? ENTRY_AGGREGATION_LAYOUT_URL : null
  ]) {
    if (src) {
      defaultTreeAdapter.appendChild(
        head,
        createHeadElement('script', [
          { name: 'defer', value: '' },
          { name: 'src', value: src }
        ])
      )
    }
  }
  return serialize(document)
}

function escapeStyleContent(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style')
}
