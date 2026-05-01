"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger

type PopoverContentProps = PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">

function PopoverContent({
  className,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          className={cn(
            "min-w-64 origin-(--transform-origin) rounded-2xl border border-border/60 bg-popover p-4 text-popover-foreground",
            "shadow-[0_8px_24px_-4px_rgb(0_0_0_/_0.10),0_4px_8px_-2px_rgb(0_0_0_/_0.06)]",
            "dark:shadow-[0_8px_24px_-4px_rgb(0_0_0_/_0.4)]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "duration-100",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
