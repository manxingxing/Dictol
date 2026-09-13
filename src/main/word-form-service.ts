import BetterSqlite3, { type Database, type Statement } from 'better-sqlite3'

type BaseFormRow = {
  word: string
}

/** Read-only access to ECDICT's explicit form-to-entry mappings. */
export class WordFormService {
  private readonly database: Database
  private readonly findBaseForms: Statement<[string], BaseFormRow>

  constructor(databasePath: string) {
    this.database = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true })
    this.database.pragma('query_only = ON')
    this.findBaseForms = this.database.prepare(`
      SELECT entry.word
      FROM ecdict_form AS form
      INNER JOIN ecdict_entry AS entry ON entry.id = form.entry_id
      WHERE form.normalized_form = ?
      ORDER BY CASE form.origin WHEN 'exchange' THEN 0 ELSE 1 END, entry.id
    `)
  }

  getBaseForms(word: string): string[] {
    const normalizedWord = word.trim().toLowerCase()
    if (!normalizedWord) return []

    const forms = [word]
    const seen = new Set([normalizedWord])
    for (const row of this.findBaseForms.all(normalizedWord)) {
      const normalizedBase = row.word.trim().toLowerCase()
      if (!normalizedBase || seen.has(normalizedBase)) continue
      seen.add(normalizedBase)
      forms.push(row.word)
    }
    return forms
  }

  dispose(): void {
    this.database.close()
  }
}
