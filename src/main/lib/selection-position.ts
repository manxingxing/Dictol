import { screen, type Point, type Rectangle } from 'electron'
import type { CapturedSelection } from '../selection-hook-service'

const MOUSE_ANCHOR_GAP = 16
const SELECTION_ANCHOR_GAP = 4
const EXPLANATION_SELECTION_GAP = 8
const EXPLANATION_POINTER_OFFSET = 12
const EXPLANATION_SCREEN_MARGIN = 12
const INVALID_COORDINATE = -99_999
const POSITION_LEVEL = {
  NONE: 0,
  MOUSE_SINGLE: 1,
  MOUSE_DUAL: 2,
  SEL_FULL: 3,
  SEL_DETAILED: 4
} as const

export type SelectionAnchor = {
  centerX: number
  top: number
  bottom: number
  gap: number
  posLevel: CapturedSelection['selection']['posLevel']
  avoidanceBounds?: Rectangle
}

type ExplanationSize = {
  width: number
  height: number
}

export function toDisplayAnchor(capture: CapturedSelection): SelectionAnchor {
  const selection = capture.selection
  switch (selection.posLevel) {
    case POSITION_LEVEL.MOUSE_SINGLE:
    case POSITION_LEVEL.MOUSE_DUAL:
      return createMouseAnchor(selection)
    case POSITION_LEVEL.SEL_FULL:
    case POSITION_LEVEL.SEL_DETAILED:
      return createSelectionAnchor(selection)
    case POSITION_LEVEL.NONE:
    default:
      return createCursorAnchor()
  }
}

function createMouseAnchor(selection: CapturedSelection['selection']): SelectionAnchor {
  return isValidPoint(selection.mousePosEnd)
    ? pointToAnchor(
        toDisplayPoint(selection.mousePosEnd),
        MOUSE_ANCHOR_GAP,
        POSITION_LEVEL.MOUSE_SINGLE
      )
    : createCursorAnchor()
}

function createSelectionAnchor(selection: CapturedSelection['selection']): SelectionAnchor {
  if (
    !isValidPoint(selection.startTop) ||
    !isValidPoint(selection.startBottom) ||
    !isValidPoint(selection.endTop) ||
    !isValidPoint(selection.endBottom)
  ) {
    return createMouseAnchor(selection)
  }

  const startTop = toDisplayPoint(selection.startTop)
  const startBottom = toDisplayPoint(selection.startBottom)
  const endTop = toDisplayPoint(selection.endTop)
  const endBottom = toDisplayPoint(selection.endBottom)
  const left = Math.min(startTop.x, startBottom.x, endTop.x, endBottom.x)
  const right = Math.max(startTop.x, startBottom.x, endTop.x, endBottom.x)
  const topY = Math.min(startTop.y, endTop.y)
  const bottomY = Math.max(startBottom.y, endBottom.y)
  if (right <= left || bottomY <= topY) return createMouseAnchor(selection)
  return {
    centerX: endBottom.x,
    top: Math.min(endTop.y, endBottom.y),
    bottom: Math.max(endTop.y, endBottom.y),
    gap: SELECTION_ANCHOR_GAP,
    posLevel: selection.posLevel,
    avoidanceBounds: { x: left, y: topY, width: right - left, height: bottomY - topY }
  }
}

export function createCursorAnchor(): SelectionAnchor {
  return pointToAnchor(screen.getCursorScreenPoint(), MOUSE_ANCHOR_GAP, POSITION_LEVEL.NONE)
}

export function createWordAnchor(wordBounds: Rectangle): SelectionAnchor {
  return {
    centerX: wordBounds.x + wordBounds.width / 2,
    top: wordBounds.y,
    bottom: wordBounds.y + wordBounds.height,
    gap: EXPLANATION_SELECTION_GAP,
    posLevel: POSITION_LEVEL.SEL_FULL,
    avoidanceBounds: wordBounds
  }
}

function isValidPoint(point: Point): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x !== INVALID_COORDINATE &&
    point.y !== INVALID_COORDINATE
  )
}

export function toDisplayPoint(point: Point): Point {
  if (!isValidPoint(point)) return screen.getCursorScreenPoint()

  const roundedPoint = { x: Math.round(point.x), y: Math.round(point.y) }
  return process.platform === 'darwin' ? roundedPoint : screen.screenToDipPoint(roundedPoint)
}

function pointToAnchor(
  point: Point,
  gap = SELECTION_ANCHOR_GAP,
  posLevel: CapturedSelection['selection']['posLevel'] = POSITION_LEVEL.NONE
): SelectionAnchor {
  return { centerX: point.x, top: point.y, bottom: point.y, gap, posLevel }
}

export function fitNearSelection(
  anchor: SelectionAnchor,
  width: number,
  height: number
): Rectangle {
  const anchorPoint = { x: anchor.centerX, y: anchor.bottom }
  const workArea = screen.getDisplayNearestPoint(anchorPoint).workArea
  const workAreaBottom = workArea.y + workArea.height
  const preferredX = Math.round(anchor.centerX - width / 2)
  const belowY = Math.round(anchor.bottom + anchor.gap)
  const aboveY = Math.round(anchor.top - height - anchor.gap)
  const x = clamp(preferredX, workArea.x, workArea.x + workArea.width - width)
  const spaceBelow = workAreaBottom - belowY
  const spaceAbove = anchor.top - anchor.gap - workArea.y
  const preferredY = spaceBelow >= height || spaceBelow >= spaceAbove ? belowY : aboveY
  const y = clamp(preferredY, workArea.y, workAreaBottom - height)
  return { x, y, width, height }
}

/** Place translation below the selection, or below the cursor when bounds are unavailable. */
export function fitTranslationNearSelection(selection?: CapturedSelection['selection']): Point {
  if (selection && hasSelectionPosition(selection.posLevel)) {
    const points = [
      selection.startTop,
      selection.startBottom,
      selection.endTop,
      selection.endBottom
    ]
    if (points.every(isValidPoint)) {
      const displayPoints = points.map(toDisplayPoint)
      return {
        x: Math.round(Math.min(...displayPoints.map((point) => point.x))),
        y: Math.round(Math.max(...displayPoints.map((point) => point.y)) + SELECTION_ANCHOR_GAP)
      }
    }
  }
  const cursor = screen.getCursorScreenPoint()
  return { x: cursor.x, y: cursor.y + MOUSE_ANCHOR_GAP }
}

export function fitExplanationNearSelection(
  anchor: SelectionAnchor,
  preferredSize: ExplanationSize
): Rectangle {
  const anchorPoint = { x: anchor.centerX, y: anchor.bottom }
  const workArea = screen.getDisplayNearestPoint(anchorPoint).workArea
  const safeLeft = workArea.x + EXPLANATION_SCREEN_MARGIN
  const safeTop = workArea.y + EXPLANATION_SCREEN_MARGIN
  const safeRight = workArea.x + workArea.width - EXPLANATION_SCREEN_MARGIN
  const safeBottom = workArea.y + workArea.height - EXPLANATION_SCREEN_MARGIN
  const { width, height } = preferredSize
  if (anchor.avoidanceBounds) {
    const target = anchor.avoidanceBounds
    const gap = EXPLANATION_SELECTION_GAP
    const candidates = [
      { x: target.x, y: target.y + target.height + gap },
      { x: target.x, y: target.y - height - gap },
      { x: target.x + target.width + gap, y: target.y },
      { x: target.x - width - gap, y: target.y }
    ].map(({ x, y }) => ({
      x: clamp(Math.round(x), safeLeft, safeRight - width),
      y: clamp(Math.round(y), safeTop, safeBottom - height),
      width,
      height
    }))
    const overlap = (candidate: Rectangle): number =>
      Math.max(
        0,
        Math.min(candidate.x + width, target.x + target.width) - Math.max(candidate.x, target.x)
      ) *
      Math.max(
        0,
        Math.min(candidate.y + height, target.y + target.height) - Math.max(candidate.y, target.y)
      )
    return candidates.reduce((best, candidate) =>
      overlap(candidate) < overlap(best) ? candidate : best
    )
  }
  const usesSelectionPosition = hasSelectionPosition(anchor.posLevel)
  const gap = usesSelectionPosition ? EXPLANATION_SELECTION_GAP : MOUSE_ANCHOR_GAP
  const preferredX = Math.round(
    anchor.centerX + (usesSelectionPosition ? 0 : EXPLANATION_POINTER_OFFSET)
  )
  const belowY = Math.round(anchor.bottom + gap)
  const aboveY = Math.round(anchor.top - gap - height)
  const spaceBelow = safeBottom - belowY
  const spaceAbove = anchor.top - gap - safeTop
  const preferredY = spaceBelow >= height || spaceBelow >= spaceAbove ? belowY : aboveY
  const x = clamp(preferredX, safeLeft, safeRight - width)
  const y = clamp(preferredY, safeTop, safeBottom - height)
  return { x, y, width, height }
}

function hasSelectionPosition(posLevel: CapturedSelection['selection']['posLevel']): boolean {
  return posLevel === POSITION_LEVEL.SEL_FULL || posLevel === POSITION_LEVEL.SEL_DETAILED
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

export function containsPoint(bounds: Rectangle, point: Point): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  )
}

export function insetRectangle(bounds: Rectangle, inset: number): Rectangle {
  return {
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: Math.max(0, bounds.width - inset * 2),
    height: Math.max(0, bounds.height - inset * 2)
  }
}
