"use client"

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type TopTab<T extends string = string> = {
  id: T
  label: string
  icon?: LucideIcon
  count?: number
  /** Small status dot on the icon — used by client-detail for overdue/open invoices. */
  dot?: "red" | "amber"
}

type Props<T extends string> = {
  tabs: TopTab<T>[]
  value: T
  onChange: (id: T) => void
  /** Optional content rendered on the right (refresh, settings cog, etc.). */
  rightContent?: React.ReactNode
  className?: string
}

/**
 * Single shared style for every top-tab strip across the hub. The active
 * tab gets a primary-coloured icon, foreground label, and a 2px primary
 * underline; everything else is muted. Identical to the Targets pattern.
 */
export function TopTabs<T extends string>({
  tabs,
  value,
  onChange,
  rightContent,
  className,
}: Props<T>) {
  return (
    <div className={cn("flex items-center justify-between border-b border-border/40", className)}>
      <div className="flex items-center gap-0">
        {tabs.map(({ id, label, icon: Icon, count, dot }) => {
          const active = value === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={cn(
                "relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all duration-150",
                active ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground",
              )}
            >
              {Icon && (
                <span className="relative">
                  <Icon
                    className={cn(
                      "h-4 w-4 transition-colors",
                      active ? "text-primary" : "",
                    )}
                  />
                  {dot && !active && (
                    <span
                      className={cn(
                        "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-background",
                        dot === "red" ? "bg-red-500" : "bg-amber-500",
                      )}
                    />
                  )}
                </span>
              )}
              {label}
              {typeof count === "number" && (
                <span
                  className={cn(
                    "ml-1 text-xs tabular-nums font-medium",
                    active ? "text-primary" : "text-muted-foreground/70",
                  )}
                >
                  {count}
                </span>
              )}
              {active && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t-full" />
              )}
            </button>
          )
        })}
      </div>
      {rightContent && <div className="flex items-center gap-3 mb-1">{rightContent}</div>}
    </div>
  )
}
