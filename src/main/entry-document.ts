import {
  ENTRY_AGGREGATION_LAYOUT_URL,
  ENTRY_BASE_URL,
  ENTRY_CONTEXT_MENU_URL,
  ENTRY_GLOBAL_STYLE_URL
} from './entry-assets'

// 如果是完整的html，就注入 css, js
// 如果不是完整的 html(没有 head，body)， 则把内容包裹在 html 之中，再嵌入 css, js
export function createEntryDocument(
  html: string,
  _dictionaryId: string,
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
  const appearance = `<meta name="color-scheme" content="light dark">`
  const headContent = `${appearance}<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">`
  const withHead = /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${headContent}`)
    : `<head>${headContent}</head>${html}`
  const customStyle =
    options.includeCustomCss !== false && customCss
      ? `<style id="dictol-custom-style">${escapeStyleContent(customCss)}</style>`
      : ''
  const globalStyle = `<link id="dictol-entry-style" rel="stylesheet" href="${ENTRY_GLOBAL_STYLE_URL}">`
  const withStyles = withHead.replace(/<\/head>/i, `${globalStyle}${customStyle}</head>`)
  const entryScripts = [
    `<script src="${ENTRY_BASE_URL}"></script>`,
    options.includeContextMenu === false ? '' : `<script src="${ENTRY_CONTEXT_MENU_URL}"></script>`,
    options.includeActiveDictionary ? `<script src="${ENTRY_AGGREGATION_LAYOUT_URL}"></script>` : ''
  ].join('')
  return /<\/body>/i.test(withStyles)
    ? withStyles.replace(/<\/body>/i, `${entryScripts}</body>`)
    : `${withStyles}${entryScripts}`
}

function escapeStyleContent(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style')
}
