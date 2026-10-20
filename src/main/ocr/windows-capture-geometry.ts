import type { Rectangle } from 'electron'

/** Map a DIP rectangle within one display to that display's native pixel rectangle. */
export function mapWindowsCaptureRegion(
  display: Rectangle,
  physicalDisplay: Rectangle,
  region: Rectangle
): { physical: Rectangle; bounds: Rectangle } {
  const left = Math.max(
    0,
    Math.min(
      physicalDisplay.width - 1,
      Math.floor(((region.x - display.x) / display.width) * physicalDisplay.width)
    )
  )
  const top = Math.max(
    0,
    Math.min(
      physicalDisplay.height - 1,
      Math.floor(((region.y - display.y) / display.height) * physicalDisplay.height)
    )
  )
  const right = Math.max(
    left + 1,
    Math.min(
      physicalDisplay.width,
      Math.ceil(((region.x + region.width - display.x) / display.width) * physicalDisplay.width)
    )
  )
  const bottom = Math.max(
    top + 1,
    Math.min(
      physicalDisplay.height,
      Math.ceil(((region.y + region.height - display.y) / display.height) * physicalDisplay.height)
    )
  )

  return {
    physical: {
      x: physicalDisplay.x + left,
      y: physicalDisplay.y + top,
      width: right - left,
      height: bottom - top
    },
    bounds: {
      x: display.x + (left / physicalDisplay.width) * display.width,
      y: display.y + (top / physicalDisplay.height) * display.height,
      width: ((right - left) / physicalDisplay.width) * display.width,
      height: ((bottom - top) / physicalDisplay.height) * display.height
    }
  }
}
