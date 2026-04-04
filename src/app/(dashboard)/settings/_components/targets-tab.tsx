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

  // Recalculate derived values whenever independent values change
  const derived = useMemo(() => deriveTargets(targets), [targets])

  function update(key: keyof KpiTargets, field: keyof TargetRange, raw: string) {
    const num = parseFloat(raw)
    if (raw !== "" && isNaN(num)) return

    setTargets((prev) => {
      const next = {
        ...prev,
        [key]: { ...prev[key], [field]: raw === "" ? 0 : num },
      }
      // Auto-derive after updating an independent key
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
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          Set global KPI target thresholds. Derived metrics (marked with &ldquo;auto&rdquo;) recalculate automatically
          when you change Cost per Lead, QR%, SU%, or CR%.
        </p>
      </div>

      <div className="space-y-4">
        {TARGET_METRICS.map((metric) => {
          const range = derived[metric.key]
          const isDerived = metric.derived
          const isRate = metric.direction === "rate"

          return (
            <div key={metric.key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{metric.label}</span>
                {isDerived && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">auto</span>
                )}
              </div>

              {/* Green threshold */}
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-[10px] text-muted-foreground/50 w-4">{isRate ? "≥" : "≤"}</span>
                <input
                  type="number"
                  value={range.green}
                  onChange={(e) => update(metric.key, "green", e.target.value)}
                  disabled={isDerived}
                  className={`w-20 h-8 rounded-md border-0 px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 ${
                    isDerived
                      ? "bg-muted/20 text-muted-foreground cursor-not-allowed"
                      : "bg-muted/40 dark:bg-white/5"
                  }`}
                />
                <span className="text-[10px] text-muted-foreground/40">{metric.unit}</span>
              </div>

              {/* Orange threshold */}
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="text-[10px] text-muted-foreground/50 w-4">{isRate ? "≥" : "≤"}</span>
                <input
                  type="number"
                  value={range.orange}
                  onChange={(e) => update(metric.key, "orange", e.target.value)}
                  disabled={isDerived}
                  className={`w-20 h-8 rounded-md border-0 px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 ${
                    isDerived
                      ? "bg-muted/20 text-muted-foreground cursor-not-allowed"
                      : "bg-muted/40 dark:bg-white/5"
                  }`}
                />
                <span className="text-[10px] text-muted-foreground/40">{metric.unit}</span>
              </div>

              {/* Red label */}
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-[10px] text-muted-foreground/40">
                  {isRate ? `< ${range.orange}${metric.unit}` : `> ${range.orange}${metric.unit}`}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            isDirty
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleReset}
          disabled={saving}
          className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          Reset to defaults
        </button>
        {saved && !isDirty && <span className="text-[11px] text-green-500">Saved</span>}
      </div>
    </div>
  )
}
