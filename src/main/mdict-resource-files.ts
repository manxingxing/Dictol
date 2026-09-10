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

  readRecords(locators: readonly MdictRecordLocator[]): Promise<string[]> {
    return Promise.all(
      locators.map((locator) =>
        this.mdx.readRecordText(
          BigInt(locator.recordStartOffset),
          BigInt(locator.recordEndOffset),
          true
        )
      )
    )
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
