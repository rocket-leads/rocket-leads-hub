"use client"

import { cn } from "@/lib/utils"

type Item<T extends string> = {
  id: T
  label: string
  /** Optional dot - used for "you have something here" affordances
   *  (eg. overdue invoice on the Billing sub-view). */
  dot?: "red" | "amber"
}

type Props<T extends string> = {
  items: Item<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}

/**
 * Pill-style segmented control - for secondary "alternate view" switches
 * inside a tab body (eg. Performance → Overview vs Campaigns). Visually
 * lighter than `TopTabs` so the user reads it as "two views of the same
 * thing" rather than "two separate sections of the app".
 *
 * Hub usage: slide-over Performance / Conversations / Admin tab bodies,
 * each with a 2-way switcher at the top.
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: Props<T>) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/60 border border-border/40",
        className,
      )}
    >
      {items.map((it) => {
        const active = value === it.id
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 h-7 px-3 rounded-[6px] text-[12px] font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {it.label}
            {it.dot && (
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  it.dot === "red" ? "bg-red-500" : "bg-amber-500",
                )}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
