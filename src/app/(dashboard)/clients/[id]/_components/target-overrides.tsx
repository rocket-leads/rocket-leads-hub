"use client"

import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { RotateCcw } from "lucide-react"
import {
  TARGET_METRICS,
  INDEPENDENT_KEYS,
  deriveTargets,
  mergeTargets,
  type KpiTargets,
  type TargetRange,
} from "@/lib/clients/targets"

type Props = {
  mondayItemId: string
}

export function TargetOverrides({ mondayItemId }: Props) {
  const queryClient = useQueryClient()

  const query = useQuery<{ global: KpiTargets; overrides: Partial<KpiTargets> | null }>({
    queryKey: ["target-overrides", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/target-overrides`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const globalTargets = query.data?.global
  const savedOverrides = query.data?.overrides

  const [localEdits, setLocalEdits] = useState<Partial<KpiTargets>>({})

  // Merge: global + saved overrides + local edits
  const currentOverrides = useMemo(() => {
    const merged: Partial<KpiTargets> = {}
    if (savedOverrides) {
      for (const [k, v] of Object.entries(savedOverrides)) {
        merged[k as keyof KpiTargets] = v as TargetRange
      }
    }
    for (const [k, v] of Object.entries(localEdits)) {
      merged[k as keyof KpiTargets] = v as TargetRange
    }
    return merged
  }, [savedOverrides, localEdits])

  // Full merged targets (for deriving)
  const effective = useMemo(() => {
    if (!globalTargets) return null
    const merged = mergeTargets(globalTargets, currentOverrides)
    // Re-derive if independent keys were overridden
    return deriveTargets(merged)
  }, [globalTargets, currentOverrides])

  const mutation = useMutation({
    mutationFn: async (overrides: Partial<KpiTargets> | null) => {
      const r = await fetch(`/api/clients/${mondayItemId}/target-overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to save")
      return r.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["target-overrides", mondayItemId] })
      queryClient.invalidateQueries({ queryKey: ["kpis", mondayItemId] })
      setLocalEdits({})
    },
  })

  function handleChange(key: keyof KpiTargets, field: keyof TargetRange, raw: string) {
    const num = parseFloat(raw)
    if (raw !== "" && isNaN(num)) return

    setLocalEdits((prev) => {
      const existing = prev[key] ?? savedOverrides?.[key] ?? {}
      const next: Partial<KpiTargets> = {
        ...prev,
        [key]: { ...existing, [field]: raw === "" ? undefined : num },
      }
      // Re-derive if editing independent keys
      if ((INDEPENDENT_KEYS as readonly string[]).includes(key) && globalTargets) {
        const full = mergeTargets(globalTargets, { ...currentOverrides, ...next })
        const derived = deriveTargets(full)
        next.cpba = derived.cpba
        next.cpta = derived.cpta
        next.cpd = derived.cpd
      }
      return next
    })
  }

  function handleSave() {
    // Clean: only save overrides that differ from global
    const cleaned: Partial<KpiTargets> = {}
    if (globalTargets) {
      for (const [k, v] of Object.entries(currentOverrides)) {
        const gVal = globalTargets[k as keyof KpiTargets]
        if (v && (v.green !== gVal.green || v.orange !== gVal.orange)) {
          cleaned[k as keyof KpiTargets] = v as TargetRange
        }
      }
    }
    mutation.mutate(Object.keys(cleaned).length > 0 ? cleaned : null)
  }

  function handleReset() {
    mutation.mutate(null)
    setLocalEdits({})
  }

  const isDirty = Object.keys(localEdits).length > 0
  const hasOverrides = savedOverrides && Object.keys(savedOverrides).length > 0

  if (!globalTargets || !effective) return null

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {TARGET_METRICS.map((metric) => {
          const globalRange = globalTargets[metric.key]
          const effectiveRange = effective[metric.key]
          const isDerived = metric.derived
          const isRate = metric.direction === "rate"
          const hasOverride =
            effectiveRange.green !== globalRange.green || effectiveRange.orange !== globalRange.orange

          return (
            <div key={metric.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{metric.label}</span>
                {isDerived && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">auto</span>
                )}
                {hasOverride && !isDerived && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">custom</span>
                )}
              </div>

              {/* Green threshold */}
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-[10px] text-muted-foreground/50 w-3">{isRate ? "≥" : "≤"}</span>
                <input
                  type="number"
                  placeholder={String(globalRange.green)}
                  value={effectiveRange.green}
                  onChange={(e) => handleChange(metric.key, "green", e.target.value)}
                  disabled={isDerived}
                  className={`w-20 h-7 rounded-md border-0 px-2 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 ${
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
                <span className="text-[10px] text-muted-foreground/50 w-3">{isRate ? "≥" : "≤"}</span>
                <input
                  type="number"
                  placeholder={String(globalRange.orange)}
                  value={effectiveRange.orange}
                  onChange={(e) => handleChange(metric.key, "orange", e.target.value)}
                  disabled={isDerived}
                  className={`w-20 h-7 rounded-md border-0 px-2 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 ${
                    isDerived
                      ? "bg-muted/20 text-muted-foreground cursor-not-allowed"
                      : "bg-muted/40 dark:bg-white/5"
                  }`}
                />
                <span className="text-[10px] text-muted-foreground/40">{metric.unit}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!isDirty || mutation.isPending}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            isDirty
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          {mutation.isPending ? "Saving..." : "Save"}
        </button>
        {hasOverrides && (
          <button
            onClick={handleReset}
            disabled={mutation.isPending}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to global
          </button>
        )}
        {mutation.isSuccess && !isDirty && (
          <span className="text-[11px] text-green-500">Saved</span>
        )}
      </div>
    </div>
  )
}
