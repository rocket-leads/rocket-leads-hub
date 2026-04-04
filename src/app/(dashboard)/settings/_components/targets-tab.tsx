"use client"

import { useState, useMemo } from "react"
import { saveKpiTargets } from "../actions"
import {
  DEFAULT_TARGETS,
  TARGET_METRICS,
  INDEPENDENT_KEYS,
  deriveTargets,
  type KpiTargets,
  type TargetRange,
} from "@/lib/clients/targets"

type Props = {
  initial: KpiTargets
}

export function TargetsTab({ initial }: Props) {
  const [targets, setTargets] = useState<KpiTargets>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const derived = useMemo(() => deriveTargets(targets), [targets])

  function update(key: keyof KpiTargets, field: keyof TargetRange, raw: string) {
    const num = parseFloat(raw)
    if (raw !== "" && isNaN(num)) return

    setTargets((prev) => {
      const next = {
        ...prev,
        [key]: { ...prev[key], [field]: raw === "" ? 0 : num },
      }
      if ((INDEPENDENT_KEYS as readonly string[]).includes(key)) {
        return deriveTargets(next)
      }
      return next
    })
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveKpiTargets(derived as unknown as Record<string, unknown>)
      setSaved(true)
    } catch (e) {
      console.error("Failed to save targets:", e)
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setTargets(DEFAULT_TARGETS)
    setSaved(false)
  }

  const isDirty = JSON.stringify(derived) !== JSON.stringify(initial)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground/70">
        Set global KPI target thresholds. Derived metrics (marked <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground align-middle mx-0.5">auto</span>) recalculate automatically
        when you adjust the independent variables.
      </p>

      {/* Table header */}
      <div className="rounded-lg border border-border/40 overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_140px_100px] items-center px-4 py-2.5 bg-muted/30 border-b border-border/30">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Metric</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 text-center">Green</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 text-center">Orange</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 text-center">Red</span>
        </div>

        {TARGET_METRICS.map((metric, i) => {
          const range = derived[metric.key]
          const isDerived = metric.derived
          const isRate = metric.direction === "rate"
          const isLast = i === TARGET_METRICS.length - 1

          return (
            <div
              key={metric.key}
              className={`grid grid-cols-[1fr_140px_140px_100px] items-center px-4 py-3 transition-colors hover:bg-muted/20 ${
                !isLast ? "border-b border-border/20" : ""
              }`}
            >
              {/* Metric name */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{metric.label}</span>
                {isDerived && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">auto</span>
                )}
              </div>

              {/* Green threshold */}
              <div className="flex items-center justify-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-[10px] text-muted-foreground/40 w-3 text-right">{isRate ? "≥" : "≤"}</span>
                <input
                  type="number"
                  value={range.green}
                  onChange={(e) => update(metric.key, "green", e.target.value)}
                  disabled={isDerived}
                  className={`w-16 h-7 rounded-md border-0 px-2 text-xs text-center tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-shadow ${
                    isDerived
                      ? "bg-transparent text-muted-foreground/60 cursor-not-allowed"
                      : "bg-muted/40 dark:bg-white/5"
                  }`}
                />
                <span className="text-[10px] text-muted-foreground/30 w-3">{metric.unit}</span>
              </div>

              {/* Orange threshold */}
              <div className="flex items-center justify-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                <span className="text-[10px] text-muted-foreground/40 w-3 text-right">{isRate ? "≥" : "≤"}</span>
                <input
                  type="number"
                  value={range.orange}
                  onChange={(e) => update(metric.key, "orange", e.target.value)}
                  disabled={isDerived}
                  className={`w-16 h-7 rounded-md border-0 px-2 text-xs text-center tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-shadow ${
                    isDerived
                      ? "bg-transparent text-muted-foreground/60 cursor-not-allowed"
                      : "bg-muted/40 dark:bg-white/5"
                  }`}
                />
                <span className="text-[10px] text-muted-foreground/30 w-3">{metric.unit}</span>
              </div>

              {/* Red label */}
              <div className="flex items-center justify-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                <span className="text-[11px] text-muted-foreground/50 tabular-nums">
                  {isRate ? `< ${range.orange}` : `> ${range.orange}`}{metric.unit}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-150 ${
            isDirty
              ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm shadow-primary/20"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          {saving ? "Saving..." : "Save targets"}
        </button>
        <button
          onClick={handleReset}
          disabled={saving}
          className="px-3 py-2 rounded-lg text-xs text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-all"
        >
          Reset to defaults
        </button>
        {saved && !isDirty && <span className="text-[11px] text-green-500 animate-in fade-in">Saved</span>}
      </div>
    </div>
  )
}
