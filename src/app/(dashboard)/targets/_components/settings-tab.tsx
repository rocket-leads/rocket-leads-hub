"use client"

import { useState, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { Skeleton } from "@/components/ui/skeleton"
import { Check, Loader2 } from "lucide-react"
import type { TargetsConfig } from "@/types/targets"

const FIELDS: { key: keyof TargetsConfig; label: string; prefix?: string; description: string }[] = [
  { key: "calls", label: "Booked Calls", description: "Monthly target for booked calls" },
  { key: "qualifiedCalls", label: "Qualified Calls", description: "Monthly target for qualified calls" },
  { key: "takenCalls", label: "Taken Calls", description: "Monthly target for taken calls" },
  { key: "deals", label: "Deals", description: "Monthly target for closed deals" },
  { key: "revenue", label: "Revenue", prefix: "€", description: "Monthly revenue target" },
  { key: "cbc", label: "Cost per Booked Call", prefix: "€", description: "Target max cost per booked call" },
  { key: "cqc", label: "Cost per Qualified Call", prefix: "€", description: "Target max cost per qualified call" },
  { key: "ctc", label: "Cost per Taken Call", prefix: "€", description: "Target max cost per taken call" },
  { key: "cpd", label: "Cost per Deal", prefix: "€", description: "Target max cost per deal" },
]

export function SettingsTab() {
  const { data: config, isLoading } = useTargetsConfig()
  const queryClient = useQueryClient()
  const [values, setValues] = useState<TargetsConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config !== undefined && !values) {
      setValues(config ?? { calls: 0, qualifiedCalls: 0, takenCalls: 0, deals: 0, revenue: 0, cbc: 0, cqc: 0, ctc: 0, cpd: 0 })
    }
  }, [config, values])

  if (isLoading || !values) {
    return (
      <div className="space-y-4 max-w-2xl">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  const hasChanges = values && JSON.stringify(values) !== JSON.stringify(config)

  async function handleSave() {
    if (!values) return
    setSaving(true)
    setSaved(false)

    const res = await fetch("/api/targets/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })

    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ["targets-config"] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }

    setSaving(false)
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-sm font-medium">Monthly Targets</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          These targets are used for pro-rata calculations in the Marketing / Sales tab. All values are monthly.
        </p>
      </div>

      <div className="space-y-3">
        {FIELDS.map(({ key, label, prefix, description }) => (
          <div key={key} className="bg-card rounded-lg p-4 border border-border/40">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-medium">{label}</label>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{description}</p>
              </div>
              <div className="flex items-center gap-1">
                {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
                <input
                  type="number"
                  step={prefix ? "0.01" : "1"}
                  min="0"
                  value={values[key]}
                  onChange={(e) => setValues({ ...values, [key]: parseFloat(e.target.value) || 0 })}
                  className="w-28 h-8 rounded-md border border-border bg-background px-2 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-2"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saving ? "Saving..." : saved ? "Saved" : "Save Targets"}
        </button>
        {hasChanges && !saving && (
          <span className="text-[11px] text-muted-foreground">Unsaved changes</span>
        )}
      </div>
    </div>
  )
}
