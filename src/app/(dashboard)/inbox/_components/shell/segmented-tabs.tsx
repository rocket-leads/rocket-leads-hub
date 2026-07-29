"use client"

import type { TopTab } from "@/components/ui/top-tabs"
import { cn } from "@/lib/utils"

/**
 * 187N segmented control — the full-width "three-tap shift" used for the inbox
 * STATE switch (Nieuw / Opgepakt / Gesloten), on both the internal and external
 * feeds. A subtle track with equal-width segments; the active segment lifts to a
 * white surface card. Deliberately distinct from the `.chip` pills used for the
 * channel tabs above it so the two rows don't read as the same control.
 * Roy 2026-07-29.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TopTab<T>[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div
      role="tablist"
      className="flex w-full items-stretch gap-1 rounded-lg border border-border/60 bg-muted/40 p-1"
    >
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-all",
              active
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="truncate">{tab.label}</span>
            {tab.count != null && tab.count > 0 && (
              <span
                className={cn(
                  "font-mono text-[10.5px] tabular-nums",
                  active ? "text-muted-foreground" : "opacity-60",
                )}
              >
                {tab.count > 99 ? "99+" : tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
