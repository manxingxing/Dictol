import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import valueParser from 'postcss-value-parser'
import { parse, serialize, type DefaultTreeAdapterTypes } from 'parse5'

export type ConcatenatedEntry = {
  dictionaryId: number
  dictionaryName: string
  html: string
  customCss?: string
}

const DICTIONARY_SCOPE_PREFIX = 'dictol-dictionary'
const AGGREGATE_BODY_ID = 'dictol-aggregate'
const DICTIONARY_COLLAPSE_MARKERS =
  '<span class="dictol-dictionary-collapse-marker"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevrons-up-down dictol-dictionary-collapse-marker-expanded" aria-hidden="true"><path d="m6 9 6 6 6-6"/></path></svg><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right dictol-dictionary-collapse-marker-collapsed" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></span>'

export function createConcatenatedEntryDocument(
  entries: readonly ConcatenatedEntry[],
  layout: 'vertical' | 'horizontal' = 'vertical'
): string {
  const sections = entries
    .map((entry) => {
      const scopeClass = getDictionaryScopeClass(entry.dictionaryId)
      const { html, htmlClass, bodyClass } = rewriteDictionaryHtml(entry.html, entry.dictionaryId)
      const customCss = entry.customCss
        ? `<style data-dictionary-custom-css="${entry.dictionaryId}">${escapeStyleContent(rewriteDictionaryCss(entry.customCss, entry.dictionaryId, { inline: true }))}</style>`
        : ''
      return `<div id="dictol-dictionary-section-${entry.dictionaryId}" class="dictol-dictionary-section dictol-dictionary-section-${entry.dictionaryId} ${escapeHtml(htmlClass)}" data-dictionary-id="${entry.dictionaryId}"><button class="dictol-dictionary-title" data-dictionary-id="${entry.dictionaryId}" aria-controls="dictol-dictionary-${entry.dictionaryId}" type="button" aria-expanded="true"><span class="dictol-dictionary-title-name">${escapeHtml(entry.dictionaryName)}</span>${DICTIONARY_COLLAPSE_MARKERS}</button><div id="dictol-dictionary-${entry.dictionaryId}" class="dictol-dictionary-entry ${scopeClass} ${escapeHtml(bodyClass)}" data-dictionary-id="${entry.dictionaryId}">${customCss}${html}</div></div>`
    })
    .join('')

  return `<body id="${AGGREGATE_BODY_ID}" data-layout="${layout}"><div id="dictol-concatenated-entry" class="dictol-concatenated-entry">${sections}</div></body>`
}

export function rewriteDictionaryCss(
  css: string,
  dictionaryId: number,
  options: { inline?: boolean } = {}
): string {
  try {
    const root = postcss.parse(css)

    root.walkRules((rule) => {
      if (isKeyframesRule(rule)) return
      rule.selector = rewriteSelectors(rule.selector, dictionaryId)
    })
    root.walkAtRules('import', (rule) => {
      rule.params = rewriteCssImportParams(rule.params, options.inline ? dictionaryId : undefined)
    })
    if (options.inline) {
      root.walkDecls((declaration) => {
        const parsed = valueParser(declaration.value)
        parsed.walk((node) => {
          if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return
          const target = node.nodes.find(
            (child) => child.type !== 'space' && child.type !== 'comment'
          )
          if (target && (target.type === 'string' || target.type === 'word')) {
            target.value = rewriteResourceHref(target.value, dictionaryId)
          }
          return false
        })
        declaration.value = parsed.toString()
      })
    }

    return root.toString()
  } catch (error) {
    console.warn('Failed to scope dictionary CSS; keeping original CSS', { dictionaryId, error })
    return css
  }
}

function rewriteDictionaryHtml(
  html: string,
  dictionaryId: number
): { html: string; htmlClass: string; bodyClass: string } {
  const document = parse(html)
  walkHtmlNode(document, (node) => {
    if (!isHtmlElement(node)) return

    const tagName = node.tagName.toLowerCase()
    if (tagName === 'style') {
      for (const child of node.childNodes) {
        if ('value' in child && child.nodeName === '#text') {
          child.value = rewriteDictionaryCss(child.value, dictionaryId, { inline: true })
        }
      }
    }
    const href = findHtmlAttribute(node, 'href')
    const src = findHtmlAttribute(node, 'src')
    if ((tagName === 'a' || tagName === 'area') && href) {
      href.value = rewriteDictionaryHref(href.value, dictionaryId)
    } else if (src && RESOURCE_SOURCE_TAGS.has(tagName)) {
      src.value = rewriteResourceHref(src.value, dictionaryId)
    } else if (href && tagName === 'link') {
      href.value = rewriteResourceHref(href.value, dictionaryId)
    }
  })
  // parse5 supplies html/head/body even for fragments. Serialize their contents
  // in document order so scripts retain their order relative to styles and markup.
  const htmlElement = document.childNodes.find(
    (node): node is DefaultTreeAdapterTypes.Element =>
      isHtmlElement(node) && node.tagName === 'html'
  )!
  const documentParts = htmlElement.childNodes.filter(
    (node): node is DefaultTreeAdapterTypes.Element =>
      isHtmlElement(node) && (node.tagName === 'head' || node.tagName === 'body')
  )
  const body = documentParts.find((node) => node.tagName === 'body')
  return {
    html: documentParts.map((node) => serialize(node)).join(''),
    htmlClass: findHtmlAttribute(htmlElement, 'class')?.value ?? '',
    bodyClass: body ? (findHtmlAttribute(body, 'class')?.value ?? '') : ''
  }
}

const RESOURCE_SOURCE_TAGS = new Set(['audio', 'iframe', 'img', 'script', 'source', 'video'])

function walkHtmlNode(
  node: DefaultTreeAdapterTypes.Node,
  visit: (node: DefaultTreeAdapterTypes.Node) => void
): void {
  visit(node)
  if (!('childNodes' in node)) return
  node.childNodes.forEach((child) => walkHtmlNode(child, visit))
}

function isHtmlElement(
  node: DefaultTreeAdapterTypes.Node
): node is DefaultTreeAdapterTypes.Element {
  return 'tagName' in node && Array.isArray(node.attrs)
}

function findHtmlAttribute(
  element: DefaultTreeAdapterTypes.Element,
  name: string
): DefaultTreeAdapterTypes.Element['attrs'][number] | undefined {
  return element.attrs.find((attribute) => attribute.name.toLowerCase() === name)
}

function rewriteDictionaryHref(href: string, dictionaryId: number): string {
  if (/^(?:sound|audio|file):\/\//i.test(href)) {
    const url = new URL(href)
    const resourcePath = url.hostname ? `/${url.hostname}${url.pathname}` : url.pathname
    return `${url.protocol}//dictionary-${dictionaryId}.dictol${resourcePath}${url.search}${url.hash}`
  }
  return href
}

function rewriteResourceHref(href: string, dictionaryId: number): string {
  const trimmed = href.trim()
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    /^(?:https?:|data:|blob:|javascript:|mailto:|\/\/)/i.test(trimmed)
  ) {
    return href
  }

  try {
    const url = new URL(trimmed, `dictol-entry://dictionary-${dictionaryId}.dictol/`)
    if (url.pathname.toLowerCase().endsWith('.css')) {
      url.searchParams.set('dictol-aggregate', '1')
    }
    return `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`
  } catch {
    return href
  }
}

function rewriteCssImportParams(params: string, dictionaryId?: number): string {
  const parsed = valueParser(params)
  const target = parsed.nodes.find((node) => node.type !== 'space' && node.type !== 'comment')
  const urlNode =
    target?.type === 'function' && target.value.toLowerCase() === 'url'
      ? target.nodes.find((node) => node.type !== 'space' && node.type !== 'comment')
      : target
  if (!urlNode || (urlNode.type !== 'string' && urlNode.type !== 'word')) return params
  if (dictionaryId !== undefined) {
    urlNode.value = rewriteResourceHref(urlNode.value, dictionaryId)
  }

  // Keep the original path (including relative segments and origin) intact.
  const value = urlNode.value
  const hashIndex = value.indexOf('#')
  const hash = hashIndex < 0 ? '' : value.slice(hashIndex)
  const withoutHash = hashIndex < 0 ? value : value.slice(0, hashIndex)
  const queryIndex = withoutHash.indexOf('?')
  const path = queryIndex < 0 ? withoutHash : withoutHash.slice(0, queryIndex)
  if (!path.toLowerCase().endsWith('.css')) return parsed.toString()

  const query = new URLSearchParams(queryIndex < 0 ? '' : withoutHash.slice(queryIndex + 1))
  query.set('dictol-aggregate', '1')
  urlNode.value = `${path}?${query}${hash}`
  return parsed.toString()
}

function rewriteSelectors(value: string, dictionaryId: number): string {
  const sectionClass = `dictol-dictionary-section-${dictionaryId}`
  const entryClass = getDictionaryScopeClass(dictionaryId)
  return selectorParser((root) => {
    root.each((selector) => {
      let hasDocumentRoot = false
      selector.walk((node) => {
        const isHtml =
          (node.type === 'tag' && node.value.toLowerCase() === 'html') ||
          (node.type === 'pseudo' && node.value.toLowerCase() === ':root')
        const isBody = node.type === 'tag' && node.value.toLowerCase() === 'body'
        if (!isHtml && !isBody) return
        hasDocumentRoot = true
        node.replaceWith(selectorParser.className({ value: isHtml ? sectionClass : entryClass }))
      })
      if (hasDocumentRoot) {
        // Root references can occur inside :is/:not/:has. Constrain the matched
        // element as well, so alternative branches cannot escape this card.
        const boundary = selectorParser()
          .astSync(`:where(.${sectionClass}, .${sectionClass} *)`)
          .first.first.clone()
        const pseudoElement = selector.nodes.find(
          (node) =>
            node.type === 'pseudo' &&
            (node.value.startsWith('::') ||
              [':before', ':after', ':first-line', ':first-letter'].includes(node.value))
        )
        if (pseudoElement) selector.insertBefore(pseudoElement, boundary)
        else selector.append(boundary)
      } else {
        selector.prepend(selectorParser.combinator({ value: ' ' }))
        selector.prepend(selectorParser.className({ value: getDictionaryScopeClass(dictionaryId) }))
      }
    })
  }).processSync(value)
}

function isKeyframesRule(rule: postcss.Rule): boolean {
  let parent = rule.parent as postcss.Container | undefined
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test((parent as postcss.AtRule).name)) return true
    parent = parent.parent as postcss.Container | undefined
  }
  return false
}

function getDictionaryScopeClass(dictionaryId: number): string {
  return `${DICTIONARY_SCOPE_PREFIX}-${dictionaryId}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character]!
  })
}

function escapeStyleContent(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style')
}
