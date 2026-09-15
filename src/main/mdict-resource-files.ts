import { MddList, Mdx, type DictionaryMetadata } from '@dictol/mdict-native'

export type MdictRecordLocator = {
  recordStartOffset: number
  recordEndOffset: number
}

/** 一部词典已经打开的 MDX/MDD 原生资源。 */
export class MdictResourceFiles {
  constructor(
    readonly dictionaryId: number,
    private readonly mdx: Mdx,
    private readonly mddList: MddList | null
  ) {}

  get metadata(): DictionaryMetadata {
    return this.mdx.metadata
  }

  readIndexRecord(locator: Buffer): Promise<string> {
    return this.mdx.readIndexRecord(locator, true)
  }

  readIndexRecords(locators: readonly Buffer[]): Promise<string[]> {
    return Promise.all(locators.map((locator) => this.readIndexRecord(locator)))
  }

  async listEntryWords(): Promise<string[]> {
    const scanner = this.mdx.keys()
    const words: string[] = []

    for (;;) {
      const batch = await scanner.nextBatch(10_000)
      words.push(...batch.entries.map((entry) => entry.keyText))
      if (batch.done) return words
    }
  }

  async prefixEntryWords(prefix: string): Promise<string[]> {
    const entries = await this.mdx.prefix(prefix)
    return entries.map((entry) => entry.keyText)
  }

  async loadResource(resourcePath: string): Promise<Buffer | null> {
    if (!this.mddList) return null

    for (const candidate of resourceCandidates(resourcePath)) {
      const resource = await this.mddList.lookup(candidate)
      if (resource) return resource.data
    }
    return null
  }

  close(): boolean {
    const mdxClosed = this.mdx.close()
    const mddClosed = this.mddList?.close() ?? true
    return mdxClosed && mddClosed
  }
}

function resourceCandidates(resourcePath: string): string[] {
  const pathWithBackslashes = resourcePath.replaceAll('/', '\\')
  const pathWithoutLeadingSeparator = pathWithBackslashes.replace(/^\\+/, '')
  return Array.from(
    new Set([
      pathWithBackslashes.startsWith('\\') ? pathWithBackslashes : `\\${pathWithBackslashes}`,
      pathWithBackslashes,
      pathWithoutLeadingSeparator,
      `\\${pathWithoutLeadingSeparator}`,
      resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`,
      `/${pathWithoutLeadingSeparator}`
    ])
  )
}
