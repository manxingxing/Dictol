import type { Rectangle } from 'electron'

export type AccessibleText = {
  text: string
  offset: number
  word: string
  bounds: Rectangle
}

export type AccessibleTextLookup = {
  result?: AccessibleText
  failure?: string
}
