import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@/lib/utils'

type ScrollAreaProps = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string
  showVerticalScrollbar?: boolean
  horizontalWheel?: boolean
}

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(
  (
    {
      className,
      children,
      viewportClassName,
      showVerticalScrollbar = true,
      horizontalWheel = false,
      ...props
    },
    ref
  ) => {
    const viewportRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      const viewport = viewportRef.current
      if (!horizontalWheel || !viewport) return
      const handleWheel = (event: WheelEvent): void => {
        // Preserve pinch-to-zoom, Shift+wheel, and native horizontal trackpad gestures.
        if (event.ctrlKey || event.shiftKey || event.deltaX !== 0 || event.deltaY === 0) return
        if (viewport.scrollWidth <= viewport.clientWidth) return
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1
        event.preventDefault()
        viewport.scrollLeft += event.deltaY * unit
      }
      viewport.addEventListener('wheel', handleWheel, { passive: false })
      return () => viewport.removeEventListener('wheel', handleWheel)
    }, [horizontalWheel])

    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        className={cn('relative overflow-hidden', className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          ref={viewportRef}
          className={cn('h-full w-full rounded-[inherit]', viewportClassName)}
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        {showVerticalScrollbar && <ScrollBar />}
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    )
  }
)
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-colors',
      orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-[1px]',
      orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[1px]',
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
