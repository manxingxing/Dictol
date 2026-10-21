export interface AccessibleText {
  text: string
  offset: number
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

/** Read the text and word bounds at a physical screen point. */
export declare function readAccessibleText(
  x: number,
  y: number,
  includeContext: boolean
): Promise<AccessibleLookup>
