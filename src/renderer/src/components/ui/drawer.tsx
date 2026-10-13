import * as React from 'react'
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer'

import { cn } from '@/lib/utils'

type DrawerContextValue = {
  hasSnapPoints: boolean
  modal: DrawerPrimitive.Root.Props['modal']
  showSwipeHandle: boolean
  swipeDirection: NonNullable<DrawerPrimitive.Root.Props['swipeDirection']>
}

const DrawerContext = React.createContext<DrawerContextValue | null>(null)

function Drawer({
  modal = true,
  showSwipeHandle = false,
  snapPoints,
  swipeDirection = 'down',
  ...props
}: DrawerPrimitive.Root.Props & { showSwipeHandle?: boolean }): React.JSX.Element {
  const value = React.useMemo(
    () => ({
      hasSnapPoints: snapPoints != null && snapPoints.length > 0,
      modal,
      showSwipeHandle,
      swipeDirection
    }),
    [modal, showSwipeHandle, snapPoints, swipeDirection]
  )

  return (
    <DrawerContext.Provider value={value}>
      <DrawerPrimitive.Root
        {...props}
        modal={modal}
        snapPoints={snapPoints}
        swipeDirection={swipeDirection}
      />
    </DrawerContext.Provider>
  )
}

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props): React.JSX.Element {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal(props: DrawerPrimitive.Portal.Props): React.JSX.Element {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose(props: DrawerPrimitive.Close.Props): React.JSX.Element {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay(props: DrawerPrimitive.Backdrop.Props): React.JSX.Element {
  return (
    <DrawerPrimitive.Backdrop
      className="fixed inset-0 z-50 bg-black/15"
      data-slot="drawer-overlay"
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  modalRegionStyle,
  ...props
}: DrawerPrimitive.Popup.Props & { modalRegionStyle?: React.CSSProperties }): React.JSX.Element {
  const context = React.useContext(DrawerContext)
  if (!context) throw new Error('DrawerContent must be used within Drawer.')
  const swipeAxis = context.swipeDirection === 'down' || context.swipeDirection === 'up' ? 'y' : 'x'

  return (
    <DrawerPortal>
      {context.modal === true && (
        <DrawerOverlay
          data-snap-points={context.hasSnapPoints || undefined}
          style={modalRegionStyle}
        />
      )}
      <DrawerPrimitive.Viewport
        className="pointer-events-none fixed inset-0 z-50 select-none data-[modal=true]:pointer-events-auto"
        data-modal={context.modal}
        data-slot="drawer-viewport"
        style={modalRegionStyle}
      >
        <DrawerPrimitive.Popup
          className={cn(
            'group/drawer-popup cn-drawer-popup pointer-events-auto fixed z-50 m-(--drawer-inset,0px) flex h-(--drawer-content-height) max-h-(--drawer-content-max-height,none) min-h-0 w-(--drawer-content-width,auto) transform-[translate3d(var(--translate-x,0px),var(--translate-y,0px),0)_scale(var(--stack-scale))] flex-col bg-background outline-none transition-[transform,height] duration-300 ease-out',
            'data-[swipe-axis=x]:inset-y-0 data-[swipe-axis=x]:flex-row data-[swipe-axis=y]:inset-x-0',
            'data-[swipe-direction=right]:right-0 data-[swipe-direction=right]:origin-right data-[swipe-direction=right]:[--closed-transform:translate3d(calc(100%+var(--drawer-inset,0px)),0,0)] data-[swipe-direction=right]:[--translate-x:calc(var(--drawer-swipe-movement-x)-var(--stack-peek-offset)-(var(--stack-shrink)*100%))]',
            'data-[swipe-direction=left]:left-0 data-[swipe-direction=left]:origin-left data-[swipe-direction=left]:[--closed-transform:translate3d(-100%,0,0)] data-[swipe-direction=left]:[--translate-x:calc(var(--drawer-swipe-movement-x)+var(--stack-peek-offset)+(var(--stack-shrink)*100%))]',
            'data-[swipe-direction=down]:bottom-0 data-[swipe-direction=down]:origin-bottom data-[swipe-direction=down]:[--closed-transform:translate3d(0,100%,0)] data-[swipe-direction=down]:[--translate-y:calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y)-var(--stack-peek-offset)-(var(--stack-shrink)*var(--stack-height)))]',
            'data-[swipe-direction=up]:top-0 data-[swipe-direction=up]:origin-top data-[swipe-direction=up]:[--closed-transform:translate3d(0,-100%,0)] data-[swipe-direction=up]:[--translate-y:calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y)+var(--stack-peek-offset)+(var(--stack-shrink)*var(--stack-height)))]',
            'data-ending-style:transform-(--closed-transform) data-starting-style:transform-(--closed-transform) data-swiping:duration-0',
            'data-[swipe-axis=y]:data-snap-points:[--drawer-content-height:100dvh] data-[swipe-axis=y]:[--drawer-content-max-height:calc(100dvh-6rem)] data-[swipe-axis=x]:[--drawer-content-width:75%] data-[swipe-axis=x]:sm:[--drawer-content-width:24rem]',
            className
          )}
          data-swipe-axis={swipeAxis}
          data-snap-points={context.hasSnapPoints || undefined}
          data-slot="drawer-popup"
          {...props}
        >
          {context.showSwipeHandle && <DrawerSwipeHandle />}
          <DrawerPrimitive.Content
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain rounded-[inherit]"
            data-slot="drawer-content"
          >
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  )
}

function DrawerSwipeHandle(props: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="relative z-10 flex shrink-0 cursor-grab active:cursor-grabbing"
      data-slot="drawer-swipe-handle"
      {...props}
    />
  )
}

function DrawerHeader(props: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className="flex shrink-0 flex-col gap-1.5" data-slot="drawer-header" {...props} />
}

function DrawerFooter(props: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div className="mt-auto flex shrink-0 flex-col gap-2" data-slot="drawer-footer" {...props} />
  )
}

function DrawerTitle(props: DrawerPrimitive.Title.Props): React.JSX.Element {
  return (
    <DrawerPrimitive.Title
      className={cn('font-semibold text-foreground', props.className)}
      data-slot="drawer-title"
      {...props}
    />
  )
}

function DrawerDescription(props: DrawerPrimitive.Description.Props): React.JSX.Element {
  return (
    <DrawerPrimitive.Description
      className={cn('text-sm text-muted-foreground', props.className)}
      data-slot="drawer-description"
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerSwipeHandle,
  DrawerTitle,
  DrawerTrigger
}
