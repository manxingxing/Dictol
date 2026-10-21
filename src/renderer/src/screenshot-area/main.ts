import './screenshot-area.css'

declare global {
  interface Window {
    dictolScreenshotArea: {
      complete: (region: { x: number; y: number; width: number; height: number }) => void
      cancel: () => void
    }
  }
}

const selection = document.getElementById('selection')!
const hint = document.getElementById('hint')!
let start: { x: number; y: number } | undefined

function rectangle(x: number, y: number): { x: number; y: number; width: number; height: number } {
  const currentX = Math.max(0, Math.min(window.innerWidth, x))
  const currentY = Math.max(0, Math.min(window.innerHeight, y))
  return {
    x: Math.min(start!.x, currentX),
    y: Math.min(start!.y, currentY),
    width: Math.abs(start!.x - currentX),
    height: Math.abs(start!.y - currentY)
  }
}

document.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  start = { x: event.clientX, y: event.clientY }
  document.body.setPointerCapture(event.pointerId)
  selection.hidden = false
  hint.hidden = true
})

document.addEventListener('pointermove', (event) => {
  if (!start) return
  const region = rectangle(event.clientX, event.clientY)
  Object.assign(selection.style, {
    left: `${region.x}px`,
    top: `${region.y}px`,
    width: `${region.width}px`,
    height: `${region.height}px`
  })
})

document.addEventListener('pointerup', (event) => {
  if (!start) return
  const region = rectangle(event.clientX, event.clientY)
  start = undefined
  if (region.width >= 5 && region.height >= 5) {
    window.dictolScreenshotArea.complete(region)
  } else {
    selection.hidden = true
    hint.hidden = false
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.dictolScreenshotArea.cancel()
})
