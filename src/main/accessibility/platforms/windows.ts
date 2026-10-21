import { readAccessibleText } from '@dictol/accessibility-native'
import { screen } from 'electron'
import type { OcrLookupMode } from '../../app-runtime'
import type { AccessibleTextLookup } from '../types'

export async function readAccessibleTextAtCursor(
  mode: OcrLookupMode
): Promise<AccessibleTextLookup> {
  const pointer = screen.getCursorScreenPoint()
  const physical = screen.dipToScreenPoint(pointer)
  let timeout: ReturnType<typeof setTimeout> | undefined
  const lookup = await Promise.race([
    readAccessibleText(physical.x, physical.y, mode === 'ai'),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), 1_200)
    })
  ]).finally(() => clearTimeout(timeout))

  if (!lookup) {
    return { failure: 'timeout' }
  }

  const result = lookup.result
  if (result && (result.word.includes('\uFFFC') || !/[\p{L}\p{N}]/u.test(result.word))) {
    return { failure: lookup.failure ?? 'object-placeholder' }
  }

  if (!result) return { failure: lookup.failure }

  const topLeft = screen.screenToDipPoint({ x: Math.floor(result.x), y: Math.floor(result.y) })
  const bottomRight = screen.screenToDipPoint({
    x: Math.ceil(result.x + result.width),
    y: Math.ceil(result.y + result.height)
  })
  return {
    result: {
      text: result.text.replaceAll('\uFFFC', ' '),
      offset: result.offset,
      word: result.word,
      bounds: {
        x: topLeft.x,
        y: topLeft.y,
        width: Math.max(1, bottomRight.x - topLeft.x),
        height: Math.max(1, bottomRight.y - topLeft.y)
      }
    },
    failure: lookup.failure
  }
}
