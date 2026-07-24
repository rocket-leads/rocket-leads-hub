"use client"

import { useState } from "react"
import { Filter, Plus, Trash2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import type { FilterConfig } from "./filters-popover"

type Props = {
  filters: FilterConfig[]
  align?: "start" | "center" | "end"
}

/**
 * Monday.com-style condition filter builder. Instead of a stack of dropdowns,
 * the user builds rows: `Where <field> is <value>` + `And <field> is <value>`,
 * with an "+ Add condition" and a per-row trash. Each row maps onto one of the
 * supplied `FilterConfig`s (option[0] is the cleared/"All" value). A row is
 * only an active filter once a real value is picked; clearing = trashing the
 * row (resets that field to its cleared value).
 */
export function ConditionFilter({ filters, align = "start" }: Props) {
  const byKey = new Map(filters.map((f) => [f.key, f]))
  const isActive = (f: FilterConfig) => f.value !== f.options[0]?.value
  const activeCount = filters.filter(isActive).length

  // Visible rows = ordered list of filter keys. Seeded from whatever is already
  // active so re-opening reflects current state.
  const [rows, setRows] = useState<string[]>(() => filters.filter(isActive).map((f) => f.key))

  const usedKeys = new Set(rows)
  const addable = filters.filter((f) => !usedKeys.has(f.key))

  const addCondition = () => {
    const next = addable[0]
    if (next) setRows((r) => [...r, next.key])
  }

  const removeRow = (key: string) => {
    const f = byKey.get(key)
    if (f) f.onChange(f.options[0].value)
    setRows((r) => r.filter((k) => k !== key))
  }

  const changeField = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return
    const oldF = byKey.get(oldKey)
    if (oldF) oldF.onChange(oldF.options[0].value) // reset the field we're leaving
    setRows((r) => r.map((k) => (k === oldKey ? newKey : k)))
  }

  const clearAll = () => {
    filters.forEach((f) => f.onChange(f.options[0].value))
    setRows([])
  }

  return (
    <Popover>
      <PopoverTrigger className={`chip h-9 px-3.5 outline-none ${activeCount > 0 ? "active" : ""}`}>
        <Filter className="h-3.5 w-3.5" />
        Filter
        {activeCount > 0 && (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--teal-wash-2)] px-1 text-[10px] font-semibold tabular-nums text-[var(--teal)]">
            {activeCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[560px] max-w-[92vw] p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
            Filter
          </p>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-muted-foreground hover:text-primary transition-colors outline-none"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="p-3 space-y-2">
          {rows.length === 0 ? (
            <p className="px-1 py-3 text-[13px] text-muted-foreground/70">
              No filters yet. Add a condition to narrow the list.
            </p>
          ) : (
            rows.map((key, i) => {
              const f = byKey.get(key)
              if (!f) return null
              const cleared = f.options[0]?.value
              // Fields available to THIS row = unused + itself.
              const fieldOptions = filters.filter((cf) => cf.key === key || !usedKeys.has(cf.key))
              const valueOptions = f.options.filter((o) => o.value !== cleared)
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60">
                    {i === 0 ? "Where" : "And"}
                  </span>

                  {/* Field */}
                  <Select value={key} onValueChange={(v) => { if (v) changeField(key, v) }}>
                    <SelectTrigger className="h-9 flex-1 min-w-0">
                      <SelectValue>{f.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {fieldOptions.map((cf) => (
                        <SelectItem key={cf.key} value={cf.key}>
                          {cf.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Operator (equality only) */}
                  <span className="shrink-0 inline-flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-[13px] text-muted-foreground">
                    is
                  </span>

                  {/* Value */}
                  <Select
                    value={f.value === cleared ? "" : f.value}
                    onValueChange={(v) => f.onChange(v ?? f.options[0].value)}
                  >
                    <SelectTrigger className="h-9 flex-1 min-w-0">
                      <SelectValue placeholder="Select a value">
                        {f.value === cleared
                          ? undefined
                          : f.options.find((o) => o.value === f.value)?.label ?? f.value}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {valueOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <button
                    type="button"
                    onClick={() => removeRow(key)}
                    aria-label="Remove condition"
                    className="shrink-0 grid h-9 w-9 place-items-center rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors outline-none"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            })
          )}

          <button
            type="button"
            onClick={addCondition}
            disabled={addable.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-foreground/80 hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed outline-none"
          >
            <Plus className="h-3.5 w-3.5" />
            Add condition
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
