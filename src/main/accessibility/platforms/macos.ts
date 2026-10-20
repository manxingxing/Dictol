import { readAccessibleText } from '@dictol/accessibility-native'
import { screen } from 'electron'
import type { OcrLookupMode } from '../../app-runtime'
import { mapOcrBoundsToRegion } from '../../ocr/ocr-crop'
import type { AccessibleTextLookup } from '../types'

export async function readAccessibleTextAtCursor(
  mode: OcrLookupMode
): Promise<AccessibleTextLookup> {
  const pointer = screen.getCursorScreenPoint()
  const lookup = await readAccessibleText(pointer.x, pointer.y, mode === 'ai')
  const result = lookup.result
  if (!result) return { failure: lookup.failure }

  const display = screen.getDisplayNearestPoint(pointer)
  const region = display.bounds
  return {
    result: {
      text: result.text,
      offset: result.offset,
      word: result.word,
      bounds: mapOcrBoundsToRegion(region, {
        x: (result.x - region.x) / region.width,
        y: (result.y - region.y) / region.height,
        width: result.width / region.width,
        height: result.height / region.height
      })
    },
    failure: lookup.failure
  }
}
