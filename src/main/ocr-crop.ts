type Size = { width: number; height: number }
type Point = { x: number; y: number }
type Rect = Point & Size
type BoundsPadding = { horizontal: number; vertical: number }

export function cropAroundPointer(
  image: Size,
  pointer: Point,
  requested: Size
): { rect: { x: number; y: number; width: number; height: number }; pointer: Point } {
  const width = Math.min(image.width, requested.width)
  const height = Math.min(image.height, requested.height)
  const pixelX = pointer.x * image.width
  const pixelY = pointer.y * image.height
  const x = Math.max(0, Math.min(image.width - width, Math.round(pixelX - width / 2)))
  const y = Math.max(0, Math.min(image.height - height, Math.round(pixelY - height / 2)))
  return {
    rect: { x, y, width, height },
    pointer: { x: (pixelX - x) / width, y: (pixelY - y) / height }
  }
}

export function mapOcrBoundsToDisplay(
  display: Rect,
  fullImage: Size,
  imageRect: Rect,
  image: Size,
  word: Rect,
  padding?: BoundsPadding
): Rect {
  const left = display.x + ((imageRect.x + word.x * image.width) / fullImage.width) * display.width
  const top =
    display.y + ((imageRect.y + word.y * image.height) / fullImage.height) * display.height
  const right = left + word.width * image.width * (display.width / fullImage.width)
  const bottom = top + word.height * image.height * (display.height / fullImage.height)
  const horizontalPadding = padding?.horizontal ?? Math.max(5, Math.min(12, (right - left) * 0.1))
  const verticalPadding = padding?.vertical ?? Math.max(3, Math.min(6, (bottom - top) * 0.2))
  const x = Math.max(display.x, Math.floor(left - horizontalPadding))
  const y = Math.max(display.y, Math.floor(top - verticalPadding))
  return {
    x,
    y,
    width: Math.max(
      1,
      Math.min(display.x + display.width, Math.ceil(right + horizontalPadding)) - x
    ),
    height: Math.max(
      1,
      Math.min(display.y + display.height, Math.ceil(bottom + verticalPadding)) - y
    )
  }
}

export function mapOcrBoundsToRegion(region: Rect, word: Rect, padding?: BoundsPadding): Rect {
  return mapOcrBoundsToDisplay(
    region,
    { width: region.width, height: region.height },
    { x: 0, y: 0, width: region.width, height: region.height },
    { width: region.width, height: region.height },
    word,
    padding
  )
}

export function contextTouchesCropEdge(display: Rect, region: Rect, context: Rect): boolean {
  const horizontalMargin = 64 / region.width
  const verticalMargin = 64 / region.height
  return (
    (region.x > display.x && context.x <= horizontalMargin) ||
    (region.y > display.y && context.y <= verticalMargin) ||
    (region.x + region.width < display.x + display.width &&
      context.x + context.width >= 1 - horizontalMargin) ||
    (region.y + region.height < display.y + display.height &&
      context.y + context.height >= 1 - verticalMargin)
  )
}
