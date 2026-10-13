export function safeHref(value: string): string | null {
  try {
    const url = new URL(value, window.location.href)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function hasNoteContent(value: string, richValue?: string | null): boolean {
  if (richValue) {
    try {
      const extract = (node: unknown): string => {
        if (!node || typeof node !== 'object') return ''
        const item = node as { type?: string; text?: string; content?: unknown[] }
        if (item.type === 'text') return item.text ?? ''
        if (item.type === 'hardBreak') return '\n'
        return (item.content ?? []).map(extract).join(' ')
      }
      return extract(JSON.parse(richValue)).trim().length > 0
    } catch {
      return value.trim().length > 0
    }
  }
  return value.trim().length > 0
}
