import { ipcRenderer } from 'electron'

type SwipeDirection = 'left' | 'right'

const SWITCH_DISTANCE = 80
const END_SETTLE_MS = 24
const INDICATOR_WIDTH = 50

type SwipeIndicator = {
  left: HTMLElement
  right: HTMLElement
}

function createSwipeIndicator(): SwipeIndicator | undefined {
  if (!document.documentElement) return undefined

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        overflow: hidden;
        pointer-events: none;
        writing-mode: horizontal-tb;
        direction: ltr;
      }
      .indicator {
        position: absolute;
        top: 50%;
        box-sizing: border-box;
        display: grid;
        place-items: center;
        width: ${INDICATOR_WIDTH}px;
        height: 96px;
        background: linear-gradient(90deg, #777, #626262);
        color: #fff;
        box-shadow: 0 1px 12px rgb(0 0 0 / 18%);
        opacity: 0;
        transition: transform 70ms ease-out, opacity 70ms linear;
        will-change: transform, opacity;
      }
      .left {
        left: 0;
        border-radius: 0 14px 14px 0;
        transform: translate(-${INDICATOR_WIDTH}px, -50%);
      }
      .right {
        right: 0;
        border-radius: 14px 0 0 14px;
        background: linear-gradient(270deg, #777, #626262);
        transform: translate(${INDICATOR_WIDTH}px, -50%);
      }
      svg { width: 26px; height: 26px; }
      @media (prefers-reduced-motion: reduce) {
        .indicator { transition-duration: 0ms !important; }
      }
    </style>
    <div class="indicator left">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 12H4m7-7-7 7 7 7" />
      </svg>
    </div>
    <div class="indicator right">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 12h16m-7-7 7 7-7 7" />
      </svg>
    </div>
  `
  document.documentElement.append(host)
  return {
    left: shadow.querySelector<HTMLElement>('.left')!,
    right: shadow.querySelector<HTMLElement>('.right')!
  }
}

/** Horizontal travel still available along the event's scroll chain. */
function horizontalScrollState(
  target: EventTarget | null,
  direction: SwipeDirection,
  initialRootScrollLeft?: number
): { remaining: number; scrollable: boolean } {
  const scrollingElement = document.scrollingElement
  let element = target instanceof Element ? target : (target as Node | null)?.parentElement
  element ??= scrollingElement
  let remaining = 0
  let scrollable = false

  while (element) {
    const max = Math.max(0, element.scrollWidth - element.clientWidth)
    if (max > 1) {
      const style = getComputedStyle(
        element === scrollingElement ? (document.body ?? element) : element
      )
      const overflow = getComputedStyle(element).overflowX
      if (element === scrollingElement || overflow === 'auto' || overflow === 'scroll') {
        scrollable = true
        const reversed =
          style.writingMode === 'vertical-rl' ||
          style.writingMode === 'sideways-rl' ||
          (style.writingMode === 'horizontal-tb' && style.direction === 'rtl')
        const scrollLeft =
          element === scrollingElement && initialRootScrollLeft !== undefined
            ? initialRootScrollLeft
            : element.scrollLeft
        const travelled = Math.min(Math.abs(scrollLeft), max)
        const left = reversed ? max - travelled : travelled
        const right = reversed ? travelled : max - travelled
        remaining += direction === 'left' ? left : right
      }
    }
    element = element.parentElement
  }

  return { remaining, scrollable }
}

/** One active finger-driven burst; momentum never contributes to its distance. */
export function installDictionarySwipe(channel: string): void {
  let active = false
  let closed = false
  let direction: SwipeDirection | undefined
  let distance = 0
  let canSwitch: boolean | undefined
  let initialRootScrollLeft: number | undefined
  let endTimer: ReturnType<typeof setTimeout> | undefined
  let indicator: SwipeIndicator | undefined

  const hideIndicator = (): void => {
    if (!indicator) return
    for (const side of [indicator.left, indicator.right]) {
      side.style.transitionDuration = '160ms'
      side.style.opacity = '0'
    }
    indicator.left.style.transform = `translate(-${INDICATOR_WIDTH}px, -50%)`
    indicator.right.style.transform = `translate(${INDICATOR_WIDTH}px, -50%)`
  }

  const showIndicator = (side: SwipeDirection): void => {
    indicator ??= createSwipeIndicator()
    if (!indicator) return
    const progress = Math.min(distance / SWITCH_DISTANCE, 1)
    const exposed = 4 + 42 * progress
    const visible = side === 'left' ? indicator.left : indicator.right
    const hidden = side === 'left' ? indicator.right : indicator.left
    hidden.style.opacity = '0'
    visible.style.transitionDuration = '70ms'
    visible.style.opacity = String(0.16 + 0.78 * progress)
    visible.style.transform = `translate(${side === 'left' ? exposed - INDICATOR_WIDTH : INDICATOR_WIDTH - exposed}px, -50%)`
  }

  const clearEndTimer = (): void => {
    if (endTimer) clearTimeout(endTimer)
    endTimer = undefined
  }

  const cancel = (): void => {
    clearEndTimer()
    hideIndicator()
    active = false
    closed = true
    direction = undefined
    distance = 0
    canSwitch = undefined
    initialRootScrollLeft = undefined
  }

  const finish = (): void => {
    clearEndTimer()
    hideIndicator()
    if (!active || closed) return
    closed = true
    active = false
    if (!direction || distance < SWITCH_DISTANCE) return
    const dictionaryId = document.querySelector<HTMLMetaElement>(
      'meta[name="dictol-dictionary-id"]'
    )?.content
    if (
      document.querySelector<HTMLMetaElement>('meta[name="dictol-entry-mode"]')?.content !==
        'single' ||
      !dictionaryId
    ) {
      return
    }
    ipcRenderer.send(channel, { direction, dictionaryId, url: location.href })
  }

  ipcRenderer.on('dictionary-swipe:begin', () => {
    // A new Begin cannot validate an unfinished earlier interaction.
    // A pending End, however, has already supplied its commit boundary.
    if (endTimer) finish()
    else cancel()
    active = true
    closed = false
    direction = undefined
    distance = 0
    canSwitch = undefined
    initialRootScrollLeft = document.scrollingElement?.scrollLeft
  })

  ipcRenderer.on('dictionary-swipe:cancel', cancel)
  window.addEventListener('blur', cancel)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancel()
  })

  ipcRenderer.on('dictionary-swipe:end', () => {
    if (!active || closed) return
    clearEndTimer()
    // The last DOM wheel can be delivered just after the main-process End.
    endTimer = setTimeout(finish, END_SETTLE_MS)
  })

  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.isTrusted) return
      if ('momentum' in event && event.momentum === true) {
        finish()
        return
      }
      if (
        document.querySelector<HTMLMetaElement>('meta[name="dictol-entry-mode"]')?.content !==
        'single'
      ) {
        hideIndicator()
        return
      }
      if (closed || !active) return
      if (event.deltaX === 0 && event.deltaY === 0) return
      if (
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.metaKey ||
        event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
        Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.2
      ) {
        if (direction !== undefined) canSwitch = false
        distance = 0
        hideIndicator()
        return
      }

      const nextDirection: SwipeDirection = event.deltaX < 0 ? 'left' : 'right'
      if (direction === undefined) {
        direction = nextDirection
        // Qualify only at the start; reaching the edge later cannot arm this gesture.
        const initialScroll = horizontalScrollState(
          event.target,
          nextDirection,
          initialRootScrollLeft
        )
        canSwitch = canSwitch !== false && initialScroll.remaining <= 1
        // A scrollable page may have reached its edge during this first wheel.
        if (!canSwitch || initialScroll.scrollable) return
      } else if (direction !== nextDirection) {
        canSwitch = false
        distance = 0
        hideIndicator()
        return
      }
      if (!canSwitch) return
      const scroll = horizontalScrollState(event.target, nextDirection)
      if (scroll.remaining > 1) {
        canSwitch = false
        distance = 0
        hideIndicator()
        return
      }
      distance += Math.abs(event.deltaX)
      showIndicator(nextDirection)
    },
    { capture: true, passive: true }
  )
}
