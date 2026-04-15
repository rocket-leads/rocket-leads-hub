"use client"

import { useState } from "react"
import { format } from "date-fns"
import { useDateRange } from "../_hooks/use-date-range"
import { useTargetsData } from "../_hooks/use-targets-data"
import { useKpiCalculations } from "../_hooks/use-kpi-calculations"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { KpiCard } from "./kpi-card"
import { RevenueProgressBar } from "./revenue-progress-bar"
import { WeeklyOverview } from "./weekly-overview"
import { FunnelChart } from "./funnel-chart"
import { IndustryTable } from "./industry-table"
import { cn } from "@/lib/utils"
import type { CountryKey } from "@/types/targets"

const COUNTRY_OPTIONS: Array<{ key: CountryKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "nl", label: "NL" },
  { key: "be", label: "BE" },
  { key: "de", label: "DE" },
  { key: "other", label: "Other" },
]

export function MarketingTab() {
  const [country, setCountry] = useState<CountryKey>("all")
  const { range, setStartDate, setEndDate, presets, applyPreset } = useDateRange()
  const data = useTargetsData(range, country)
  const { data: targets } = useTargetsConfig()
  const { kpiGroups, revenueProgress } = useKpiCalculations(
    data.monday, data.meta, range,
    data.mondayLoading, data.metaLoading,
    data.mondayError, data.metaError,
    targets ?? undefined,
  )

  return (
    <div className="space-y-4">
      {/* ── FILTERS ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={format(range.startDate, "yyyy-MM-dd")}
            onChange={(e) => setStartDate(new Date(e.target.value))}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={format(range.endDate, "yyyy-MM-dd")}
            onChange={(e) => setEndDate(new Date(e.target.value))}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          />
        </div>
        <div className="flex gap-1">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className="h-7 px-2.5 text-[11px] rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 ml-auto bg-muted rounded-md p-0.5">
          {COUNTRY_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setCountry(key)}
              className={cn(
                "h-7 px-3 text-[11px] font-medium rounded transition-colors",
                country === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── REVENUE BAR ── */}
      <RevenueProgressBar
        current={revenueProgress.current}
        proRata={revenueProgress.proRata}
        monthlyTarget={revenueProgress.monthlyTarget}
        isLoading={data.mondayLoading}
      />

      {/* ── SALES FUNNEL (full width, prominent) ── */}
      <FunnelChart
        calls={data.monday?.calls ?? 0}
        qualified={data.monday?.qualifiedCalls ?? 0}
        taken={data.monday?.takenCalls ?? 0}
        deals={data.monday?.deals ?? 0}
        revenue={data.monday?.closedRevenue ?? 0}
        adSpend={data.meta?.spend ?? 0}
        isLoading={data.mondayLoading || data.metaLoading}
      />

      {/* ── KPI CARDS ── */}
      {kpiGroups.map((group) => (
        <div key={group.title}>
          <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">{group.title}</h2>
          <div className={cn(
            "grid gap-2",
            group.kpis.length <= 4
              ? "grid-cols-2 sm:grid-cols-4"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6",
          )}>
            {group.kpis.map((kpi) => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </div>
        </div>
      ))}

      {/* ── WEEKLY + INDUSTRY (equal height, side by side) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <WeeklyOverview data={data.monday?.weekly ?? []} isLoading={data.mondayLoading} />
        <IndustryTable data={data.monday?.industries ?? []} isLoading={data.mondayLoading} />
      </div>
    </div>
  )
}
