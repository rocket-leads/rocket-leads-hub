"use client"

import type { TopTab } from "@/components/ui/top-tabs"
import { cn } from "@/lib/utils"

/**
 * 187N filter-tab strip: `.chip` toggles with an optional mono count. Replaces
 * the `TopTabs` primitive inside the inbox feeds so the state switch (Nieuw /
 * Opgepakt / Gesloten) reads in the 187N vocabulary. Reuses the `TopTab` type;
 * the icon/accent/dot fields are ignored here (chips carry the state via the
 * purple-wash active fill). Part of the 187N re-skin.
 */
export function ChipTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TopTab<T>[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-pressed={active}
            className={cn("chip h-8", active && "active")}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className="font-mono text-[10.5px] tabular-nums opacity-70">
                {tab.count > 99 ? "99+" : tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
