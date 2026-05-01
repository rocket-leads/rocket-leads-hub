import * as React from "react"
import { cn } from "@/lib/utils"

type PanelProps = React.ComponentProps<"div"> & {
  padded?: boolean
}

export function Panel({ className, padded = false, ...props }: PanelProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card",
        "shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04),0_1px_3px_-1px_rgb(0_0_0_/_0.04)]",
        "dark:shadow-[0_1px_2px_0_rgb(0_0_0_/_0.3)]",
        padded && "p-5",
        className
      )}
      {...props}
    />
  )
}
