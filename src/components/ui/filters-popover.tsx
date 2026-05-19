"use client"

import { Filter } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"

export type FilterConfig = {
  /** Stable key — used for React mapping. */
  key: string
  /** Section label shown above the dropdown (e.g., "Status"). */
  label: string
  /** Current value (controlled). */
  value: string
  /** Callback to update value. */
  onChange: (next: string) => void
  /** Options to render. The first option is treated as the "All / cleared" state. */
  options: Array<{ value: string; label: string }>
}

type Props = {
  filters: FilterConfig[]
  /** Optional align ("start" | "center" | "end"). Defaults to "start". */
  align?: "start" | "center" | "end"
}

/**
 * Single "Filters" button that opens a popover with all filters stacked
 * vertically with section labels. Active filter count appears as a badge
 * on the trigger; a "Clear all" link is shown when at least one is active.
 */
export function FiltersPopover({ filters, align = "start" }: Props) {
  const activeCount = filters.reduce((acc, f) => {
    const cleared = f.options[0]?.value
    return acc + (f.value !== cleared ? 1 : 0)
  }, 0)

  const clearAll = () => {
    filters.forEach((f) => {
      const cleared = f.options[0]?.value
      if (cleared !== undefined && f.value !== cleared) f.onChange(cleared)
    })
  }

  return (
    <Popover>
      <PopoverTrigger
        className={`inline-flex items-center gap-1.5 h-10 rounded-lg border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted/40 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
          activeCount > 0 ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <Filter className="h-3.5 w-3.5" />
        Filters
        {activeCount > 0 && (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold tabular-nums text-primary">
            {activeCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">Filters</p>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="space-y-3.5">
          {filters.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.12em]">
                {f.label}
              </label>
              <Select value={f.value} onValueChange={(v) => f.onChange(v ?? f.options[0]?.value ?? "")}>
                <SelectTrigger className="w-full h-9 bg-background dark:bg-input/30">
                  <SelectValue>{f.options.find((o) => o.value === f.value)?.label ?? f.value}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {f.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
