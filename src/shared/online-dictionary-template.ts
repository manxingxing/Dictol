export function fillDictionaryUrlTemplate(template: string, term: string): string {
  return template.replace(/%s|\{w\}|\{uc_d\}|\{uc_u\}/g, (placeholder) => {
    if (placeholder === '%s' || placeholder === '{w}') return encodeURIComponent(term)

    const codePoint = term.codePointAt(0)
    if (codePoint === undefined) return ''
    return placeholder === '{uc_d}'
      ? codePoint.toString(10)
      : `U${codePoint.toString(16).toUpperCase().padStart(5, '0')}`
  })
}
