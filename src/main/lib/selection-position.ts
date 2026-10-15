import { screen, type Point, type Rectangle } from 'electron'
import type { CapturedSelection } from '../selection-hook-service'

const MOUSE_ANCHOR_GAP = 16
const SELECTION_ANCHOR_GAP = 4
const EXPLANATION_SELECTION_GAP = 8
const EXPLANATION_POINTER_OFFSET = 12
const EXPLANATION_SCREEN_MARGIN = 12
const EXPLANATION_MIN_WIDTH = 360
const EXPLANATION_MIN_HEIGHT = 300
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
    ? toDisplayCoordinates(
        pointToAnchor(selection.mousePosEnd, MOUSE_ANCHOR_GAP, selection.posLevel)
      )
    : createCursorAnchor()
}

function createSelectionAnchor(selection: CapturedSelection['selection']): SelectionAnchor {
  if (!isValidPoint(selection.endBottom)) return createMouseAnchor(selection)

  const top = isValidPoint(selection.endTop) ? selection.endTop.y : selection.endBottom.y
  return toDisplayCoordinates({
    centerX: selection.endBottom.x,
    top: Math.min(top, selection.endBottom.y),
    bottom: Math.max(top, selection.endBottom.y),
    gap: SELECTION_ANCHOR_GAP,
    posLevel: selection.posLevel
  })
}

export function createCursorAnchor(): SelectionAnchor {
  return pointToAnchor(screen.getCursorScreenPoint(), MOUSE_ANCHOR_GAP, POSITION_LEVEL.NONE)
}

function isValidPoint(point: Point): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x !== INVALID_COORDINATE &&
    point.y !== INVALID_COORDINATE
  )
}

function toDisplayCoordinates(anchor: SelectionAnchor): SelectionAnchor {
  if (process.platform === 'darwin') {
    return {
      centerX: Math.round(anchor.centerX),
      top: Math.round(anchor.top),
      bottom: Math.round(anchor.bottom),
      gap: anchor.gap,
      posLevel: anchor.posLevel
    }
  }

  const top = screen.screenToDipPoint({ x: Math.round(anchor.centerX), y: Math.round(anchor.top) })
  const bottom = screen.screenToDipPoint({
    x: Math.round(anchor.centerX),
    y: Math.round(anchor.bottom)
  })
  return {
    centerX: bottom.x,
    top: Math.min(top.y, bottom.y),
    bottom: Math.max(top.y, bottom.y),
    gap: anchor.gap,
    posLevel: anchor.posLevel
  }
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
  const availableWidth = Math.max(1, safeRight - safeLeft)
  const availableHeight = Math.max(1, safeBottom - safeTop)
  const width = Math.min(Math.max(preferredSize.width, EXPLANATION_MIN_WIDTH), availableWidth)
  const height = Math.min(Math.max(preferredSize.height, EXPLANATION_MIN_HEIGHT), availableHeight)
  const usesSelectionPosition = hasSelectionPosition(anchor.posLevel)
  const gap = usesSelectionPosition ? EXPLANATION_SELECTION_GAP : MOUSE_ANCHOR_GAP
  const preferredX = Math.round(
    anchor.centerX + (usesSelectionPosition ? 0 : EXPLANATION_POINTER_OFFSET)
  )
  const preferredY = Math.round(anchor.bottom + gap)
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
