import type { DictionarySearchScopeSource } from '../shared/dictionary-search-scope'

export type DictionarySearchGroupId = number | undefined
export type DictionarySearchScopeListener = (change: {
  groupId: DictionarySearchGroupId
  source: DictionarySearchScopeSource
}) => void

/** Transient process-wide search scope shared by renderer and resource handlers. */
export class DictionarySearchScope {
  private groupId: DictionarySearchGroupId
  private readonly listeners = new Set<DictionarySearchScopeListener>()

  constructor(initialGroupId: DictionarySearchGroupId = undefined) {
    this.groupId = initialGroupId
  }

  get(): DictionarySearchGroupId {
    return this.groupId
  }

  set(groupId: DictionarySearchGroupId, source: DictionarySearchScopeSource): void {
    if (this.groupId === groupId) return
    this.groupId = groupId
    this.listeners.forEach((listener) => listener({ groupId, source }))
  }

  subscribe(listener: DictionarySearchScopeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.listeners.clear()
    this.groupId = undefined
  }
}
