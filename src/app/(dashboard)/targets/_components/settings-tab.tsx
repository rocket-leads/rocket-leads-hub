"use client"

import { useState, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { Skeleton } from "@/components/ui/skeleton"
import { Check, Loader2 } from "lucide-react"
import type { TargetsConfig } from "@/types/targets"

type Field = { key: keyof TargetsConfig; label: string; prefix?: string; suffix?: string; step?: string }

const MARKETING_FIELDS: Field[] = [
  { key: "calls", label: "Booked Calls" },
  { key: "qualifiedCalls", label: "Qualified Calls" },
  { key: "takenCalls", label: "Taken Calls" },
  { key: "deals", label: "Deals" },
  { key: "revenue", label: "Revenue", prefix: "€" },
  { key: "cbc", label: "Max Cost per Booked Call", prefix: "€", step: "0.01" },
  { key: "cqc", label: "Max Cost per Qualified Call", prefix: "€", step: "0.01" },
  { key: "ctc", label: "Max Cost per Taken Call", prefix: "€", step: "0.01" },
  { key: "cpd", label: "Max Cost per Deal", prefix: "€", step: "0.01" },
]

const FINANCE_FIELDS: Field[] = [
  { key: "serviceFeeRevenue", label: "Service Fee Revenue", prefix: "€" },
  { key: "adBudgetRevenue", label: "Ad Budget Revenue", prefix: "€" },
  { key: "totalCosts", label: "Max Total Costs", prefix: "€" },
  { key: "netProfit", label: "Net Profit", prefix: "€" },
  { key: "profitMargin", label: "Profit Margin", suffix: "%", step: "0.01" },
]

const DELIVERY_FIELDS: Field[] = [
  { key: "mrr", label: "MRR (Returning Revenue)", prefix: "€" },
  { key: "newBusiness", label: "New Business Revenue", prefix: "€" },
  { key: "activeCustomers", label: "Active Customers" },
  { key: "avgRevenuePerCustomer", label: "Avg Revenue / Customer", prefix: "€", step: "0.01" },
  { key: "maxChurnRate", label: "Max Churn Rate", suffix: "%", step: "0.01" },
]

const SECTIONS = [
  { title: "Marketing / Sales", fields: MARKETING_FIELDS },
  { title: "Finance", fields: FINANCE_FIELDS },
  { title: "Delivery", fields: DELIVERY_FIELDS },
]

const EMPTY_CONFIG: TargetsConfig = {
  calls: 0, qualifiedCalls: 0, takenCalls: 0, deals: 0, revenue: 0,
  cbc: 0, cqc: 0, ctc: 0, cpd: 0,
  serviceFeeRevenue: 0, adBudgetRevenue: 0, totalCosts: 0, netProfit: 0, profitMargin: 0,
  mrr: 0, newBusiness: 0, activeCustomers: 0, avgRevenuePerCustomer: 0, maxChurnRate: 0,
}

export function SettingsTab() {
  const { data: config, isLoading } = useTargetsConfig()
  const queryClient = useQueryClient()
  const [values, setValues] = useState<TargetsConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config !== undefined && !values) {
      setValues(config ?? { ...EMPTY_CONFIG })
    }
  }, [config, values])

  if (isLoading || !values) {
    return (
      <div className="space-y-4 max-w-2xl">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    )
  }

  const hasChanges = values && JSON.stringify(values) !== JSON.stringify(config)

  async function handleSave() {
    if (!values) return
    setSaving(true)
    setSaved(false)

    // Convert percentage fields from display (30) to decimal (0.30) for storage
    const toSave = { ...values }
    // profitMargin and maxChurnRate are stored as decimals but displayed as percentages
    // The input already stores the raw value, so we keep it as-is

    const res = await fetch("/api/targets/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toSave),
    })

    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ["targets-config"] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }

    setSaving(false)
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-sm font-medium">Monthly Targets</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Set targets for each tab. Values are compared pro-rata against the current period. Set to 0 to disable a target.
        </p>
      </div>

      {SECTIONS.map(({ title, fields }) => (
        <div key={title} className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground border-b border-border/40 pb-2">
            {title}
          </h3>
          {fields.map(({ key, label, prefix, suffix, step }) => (
            <div key={key} className="flex items-center justify-between py-2">
              <span className="text-xs">{label}</span>
              <div className="flex items-center gap-1">
                {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
                <input
                  type="number"
                  step={step ?? "1"}
                  min="0"
                  value={values[key]}
                  onChange={(e) => setValues({ ...values, [key]: parseFloat(e.target.value) || 0 })}
                  className="w-28 h-8 rounded-md border border-border bg-background px-2 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2">
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
