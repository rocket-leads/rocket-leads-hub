import * as React from "react"
import { cn } from "@/lib/utils"

type PanelProps = React.ComponentProps<"div"> & {
  padded?: boolean
}

export function Panel({ className, padded = false, ...props }: PanelProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card",
        "shadow-[var(--shadow-md)]",
        padded && "p-5",
        className
      )}
      {...props}
    />
  )
}
