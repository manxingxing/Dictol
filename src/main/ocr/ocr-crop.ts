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

export function mapOcrBoundsToRegion(region: Rect, word: Rect, padding?: BoundsPadding): Rect {
  const left = region.x + word.x * region.width
  const top = region.y + word.y * region.height
  const right = left + word.width * region.width
  const bottom = top + word.height * region.height
  const horizontalPadding = padding?.horizontal ?? Math.max(2, Math.min(5, (right - left) * 0.05))
  const verticalPadding = padding?.vertical ?? Math.max(1, Math.min(3, (bottom - top) * 0.1))
  const x = Math.max(region.x, Math.floor(left - horizontalPadding))
  const y = Math.max(region.y, Math.floor(top - verticalPadding))
  return {
    x,
    y,
    width: Math.max(
      1,
      Math.min(region.x + region.width, Math.ceil(right + horizontalPadding)) - x
    ),
    height: Math.max(
      1,
      Math.min(region.y + region.height, Math.ceil(bottom + verticalPadding)) - y
    )
  }
}

export function mapOcrQuadToRegion(
  region: Rect,
  quad: Point[]
): { bounds: Rect; quad: Point[] } | null {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad.map((point) => ({
    x: region.x + point.x * region.width,
    y: region.y + point.y * region.height
  }))
  const inlineLength = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y)
  const axisLength = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y)
  if (!inlineLength || !axisLength) return null
  const inline = {
    x: (topRight.x - topLeft.x) / inlineLength,
    y: (topRight.y - topLeft.y) / inlineLength
  }
  const axis = {
    x: (bottomLeft.x - topLeft.x) / axisLength,
    y: (bottomLeft.y - topLeft.y) / axisLength
  }
  const horizontalPadding = Math.max(2, Math.min(5, inlineLength * 0.05))
  const verticalPadding = Math.max(1, Math.min(3, axisLength * 0.1))
  const extend = (point: Point, horizontal: number, vertical: number): Point => ({
    x: point.x + inline.x * horizontal * horizontalPadding + axis.x * vertical * verticalPadding,
    y: point.y + inline.y * horizontal * horizontalPadding + axis.y * vertical * verticalPadding
  })
  const expanded = [
    extend(topLeft, -1, -1),
    extend(topRight, 1, -1),
    extend(bottomRight, 1, 1),
    extend(bottomLeft, -1, 1)
  ]
  const x = Math.max(region.x, Math.floor(Math.min(...expanded.map((point) => point.x))))
  const y = Math.max(region.y, Math.floor(Math.min(...expanded.map((point) => point.y))))
  return {
    bounds: {
      x,
      y,
      width: Math.max(
        1,
        Math.min(
          region.x + region.width,
          Math.ceil(Math.max(...expanded.map((point) => point.x)))
        ) - x
      ),
      height: Math.max(
        1,
        Math.min(
          region.y + region.height,
          Math.ceil(Math.max(...expanded.map((point) => point.y)))
        ) - y
      )
    },
    quad: expanded
  }
}

export function contextTouchesCropEdge(
  display: Rect,
  region: Rect,
  context: Rect,
  margin: BoundsPadding = { horizontal: 64, vertical: 64 }
): boolean {
  const horizontalMargin = margin.horizontal / region.width
  const verticalMargin = margin.vertical / region.height
  return (
    (region.x > display.x && context.x <= horizontalMargin) ||
    (region.y > display.y && context.y <= verticalMargin) ||
    (region.x + region.width < display.x + display.width &&
      context.x + context.width >= 1 - horizontalMargin) ||
    (region.y + region.height < display.y + display.height &&
      context.y + context.height >= 1 - verticalMargin)
  )
}
