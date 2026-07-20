"use client"

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Per-tab accent colour. Overrides the default primary tint on the active
 *  tab so different tab strips can carry their own colour language. Used
 *  by the inbox main tabs to match the row rail palette (violet=Tasks,
 *  sky=Updates, emerald=Client). When omitted, the active tab falls back
 *  to the brand primary purple. */
export type TabAccent = "primary" | "violet" | "sky" | "emerald" | "red" | "amber"

export type TopTab<T extends string = string> = {
  id: T
  label: string
  icon?: LucideIcon
  count?: number
  /** Small status dot on the icon - used by client-detail for overdue/open invoices. */
  dot?: "red" | "amber"
  /** Active-state accent. Defaults to `primary` when unset. */
  accent?: TabAccent
  /** When true, a small green check appears next to the label. Used by
   *  Pedro to surface "Brief saved", "Angles saved", etc. so the CM can
   *  see at-a-glance how far the current campaign is. */
  done?: boolean
}

/** Maps `TabAccent` to the Tailwind classes used on the active tab. Single
 *  source of truth so the icon, count, and underline all stay in sync.
 *  Inactive state never uses these - it's always muted regardless of the
 *  accent, otherwise the tabs would look like a coloured carousel and the
 *  user wouldn't be able to tell which one is selected. */
const ACCENT_CLASSES: Record<TabAccent, { icon: string; count: string; bar: string }> = {
  primary: { icon: "text-primary", count: "text-primary", bar: "bg-primary" },
  violet: {
    icon: "text-violet-500 dark:text-violet-400",
    count: "text-violet-600 dark:text-violet-300",
    bar: "bg-violet-500",
  },
  sky: {
    icon: "text-sky-500 dark:text-sky-400",
    count: "text-sky-600 dark:text-sky-300",
    bar: "bg-sky-500",
  },
  emerald: {
    icon: "text-emerald-500 dark:text-emerald-400",
    count: "text-emerald-600 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  red: {
    icon: "text-red-500 dark:text-red-400",
    count: "text-red-600 dark:text-red-300",
    bar: "bg-red-500",
  },
  amber: {
    icon: "text-amber-500 dark:text-amber-400",
    count: "text-amber-600 dark:text-amber-300",
    bar: "bg-amber-500",
  },
}

type Props<T extends string> = {
  tabs: TopTab<T>[]
  value: T
  onChange: (id: T) => void
  /** Optional content rendered on the right (refresh, settings cog, etc.). */
  rightContent?: React.ReactNode
  className?: string
  /** Tight padding + no icons, for narrow columns (e.g. the compact inbox
   *  ticket-list where Open/Opgepakt/Gesloten must fit a ~270px strip). */
  compact?: boolean
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
  compact,
}: Props<T>) {
  return (
    <div className={cn("flex items-center justify-between border-b border-border/40", className)}>
      <div className={cn("flex items-center", compact ? "gap-0.5" : "gap-0")}>
        {tabs.map(({ id, label, icon: Icon, count, dot, accent, done }) => {
          const active = value === id
          const palette = ACCENT_CLASSES[accent ?? "primary"]
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={cn(
                "relative flex items-center font-medium transition-all duration-150",
                compact ? "gap-1.5 px-2.5 py-2 text-[13px]" : "gap-2 px-5 py-3 text-sm",
                active ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground",
              )}
            >
              {Icon && !compact && (
                <span className="relative">
                  <Icon
                    className={cn(
                      "h-4 w-4 transition-colors",
                      active ? palette.icon : "",
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
              {done && !active && (
                <span
                  className="ml-0.5 inline-flex items-center justify-center text-emerald-500 dark:text-emerald-400"
                  aria-label="opgeslagen"
                  title="Opgeslagen voor deze klant"
                >
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                  </svg>
                </span>
              )}
              {typeof count === "number" && (
                <span
                  className={cn(
                    "text-xs tabular-nums font-medium",
                    compact ? "ml-0.5" : "ml-1",
                    active ? palette.count : "text-muted-foreground/70",
                  )}
                >
                  {count}
                </span>
              )}
              {active && (
                <span className={cn("absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full", palette.bar)} />
              )}
            </button>
          )
        })}
      </div>
      {rightContent && <div className="flex items-center gap-3 mb-1">{rightContent}</div>}
    </div>
  )
}
