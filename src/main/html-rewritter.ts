import { parse, serialize, type DefaultTreeAdapterTypes } from 'parse5'
import { parseNativeDictionaryResourcePath } from './dictionary-entry-url'

export const RESOURCE_SOURCE_TAGS = new Set(['audio', 'iframe', 'img', 'script', 'source', 'video'])

/** 单词典释义html的重写管线 */
export function processEntryContent(html: string, dictionaryId: number): string {
  const document = parse(html)
  walkHtmlNode(document, (node) => {
    if (!isHtmlElement(node)) return

    const tagName = node.tagName.toLowerCase()
    if (tagName === 'img') addLazyLoadingToImage(node)
    if (tagName === 'audio') deferAudioDownload(node)

    // 重写可替换元素的 src=file:// 链接为相对路径(自动使用当前带有 dictionary ID的hostname，以便支持 session.fetch 方式获取bytes，支持摘抄
    // 单词典模式下，其他标签的 file:// 链接通过兜底的registerDictionaryViewProtocolHanders，即使不重写也能正常加载
    if (RESOURCE_SOURCE_TAGS.has(tagName)) {
      let attr = getAttr(node, 'src')
      if (attr) {
        const fullPath = parseNativeDictionaryResourcePath(attr.value, 'file', true)
        if (fullPath) attr.value = fullPath
      }
    }

    if (tagName !== 'a' && tagName !== 'area') return
    const href = getAttr(node, 'href')
    if (href) href.value = rewriteEntryHref(href.value, dictionaryId)
  })
  return serialize(document)
}

export function rewriteEntryHref(href: string, dictionaryId: number): string {
  if (!/^entry:\/\//i.test(href)) return href
  const word = href.replace(/^entry:\/\/\/?/i, '')
  if (!word) return href
  return `entry://dictionary-${dictionaryId}/${word}`
}

export function addLazyLoadingToImage(element: DefaultTreeAdapterTypes.Element): void {
  if (!hasAttr(element, 'loading')) {
    element.attrs.push({ name: 'loading', value: 'lazy' })
  }
}

export function deferAudioDownload(element: DefaultTreeAdapterTypes.Element): void {
  if (
    !hasAttr(element, 'autoplay') &&
    !hasAttr(element, 'preload') &&
    !hasAttr(element, 'controls')
  ) {
    element.attrs.push({ name: 'preload', value: 'none' })
  }
}

export function getAttr(
  node: DefaultTreeAdapterTypes.Element,
  attribute: string
): DefaultTreeAdapterTypes.Element['attrs'][number] | undefined {
  return node.attrs.find((item) => item.name.toLowerCase() === attribute)
}

function hasAttr(node: DefaultTreeAdapterTypes.Element, attribute: string): boolean {
  return getAttr(node, attribute) !== undefined
}

export function walkHtmlNode(
  node: DefaultTreeAdapterTypes.Node,
  visit: (node: DefaultTreeAdapterTypes.Node) => void
): void {
  visit(node)
  if ('childNodes' in node) node.childNodes.forEach((child) => walkHtmlNode(child, visit))
}

export function isHtmlElement(
  node: DefaultTreeAdapterTypes.Node
): node is DefaultTreeAdapterTypes.Element {
  return 'tagName' in node && Array.isArray(node.attrs)
}

export function findChildNode(
  node: DefaultTreeAdapterTypes.Node,
  tagNames: readonly string[]
): DefaultTreeAdapterTypes.Element | undefined {
  if (!('childNodes' in node)) return undefined
  return node.childNodes.find(
    (child): child is DefaultTreeAdapterTypes.Element =>
      isHtmlElement(child) && tagNames.includes(child.tagName.toLowerCase())
  )
}

export function findChildNodes(
  node: DefaultTreeAdapterTypes.Node,
  tagNames: readonly string[]
): DefaultTreeAdapterTypes.Element[] {
  if (!('childNodes' in node)) return []
  return node.childNodes.filter(
    (child): child is DefaultTreeAdapterTypes.Element =>
      isHtmlElement(child) && tagNames.includes(child.tagName.toLowerCase())
  )
}
