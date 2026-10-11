export type DictionaryNoteAttachmentItem = {
  id: string
  storageKey: string
  mimeType: string
  byteSize: number
  width: number
  height: number
}

export type DictionaryNoteItem = {
  id: string
  relatedTerms: string[]
  excerpt: string | null
  comment: string | null
  commentRich: string | null
  searchMatches?: { excerpt: string[]; comment: string[] }
  attachments: DictionaryNoteAttachmentItem[]
  sourceDictionaryName: string | null
  sourceEntryTerm: string | null
  createdAt: string
  updatedAt: string
}

export type DictionaryNoteSearchResult = {
  items: DictionaryNoteItem[]
  total: number
}

export type DictionaryNoteWordGroupItem = {
  term: string
  normalizedTerm: string
  latestCreatedAt: string
  notes: DictionaryNoteItem[]
}

export type DictionaryNoteWordGroupSearchResult = {
  items: DictionaryNoteWordGroupItem[]
  total: number
}

export type CreateDictionaryNoteRequest = {
  relatedTerms: string[]
  excerpt?: string | null
  comment?: string | null
  commentRich?: string | null
  sourceDictionaryId?: string | null
  sourceEntryTerm?: string | null
  imageBytes?: Uint8Array[]
}

export type UpdateDictionaryNoteContentRequest = {
  comment: string | null
  commentRich?: string | null
}

export type DictionaryNoteCreationResultEvent =
  { status: 'success'; term: string } | { status: 'fail'; term: string; message: string }
