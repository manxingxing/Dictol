export interface AccessibleText {
  text?: string
  offset?: number
  word: string
  x: number
  y: number
  width: number
  height: number
}

export interface AccessibleLookup {
  result?: AccessibleText
  failure?: string
}

/** Read a word and its bounds; includeContext also returns text and its UTF-16 offset. */
export declare function readAccessibleText(
  x: number,
  y: number,
  includeContext?: boolean
): Promise<AccessibleLookup>
