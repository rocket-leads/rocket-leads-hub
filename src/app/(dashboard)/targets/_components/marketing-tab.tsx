"use client"

import { useState } from "react"
import { format, getDaysInMonth, startOfMonth, differenceInDays, max as dateMax } from "date-fns"
import { useDateRange } from "../_hooks/use-date-range"
import { useTargetsData } from "../_hooks/use-targets-data"
import { useKpiCalculations } from "../_hooks/use-kpi-calculations"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { KpiCard } from "./kpi-card"
import { RevenueProgressBar } from "./revenue-progress-bar"
import { WeeklyOverview } from "./weekly-overview"
import { FunnelChart } from "./funnel-chart"
import { IndustryTable } from "./industry-table"
import { MarketingInsights } from "./marketing-insights"
import { cn } from "@/lib/utils"
import { formatCurrencyDecimal, safeDivide } from "@/lib/targets/formatters"
import type { CountryKey, DateRange } from "@/types/targets"

const COUNTRY_OPTIONS: Array<{ key: CountryKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "nl", label: "NL" },
  { key: "be", label: "BE" },
  { key: "de", label: "DE" },
  { key: "other", label: "Other" },
]

/** Pro-rata a monthly target to where we should be in the current range */
function proRata(monthlyTarget: number, range: DateRange): number {
  if (monthlyTarget <= 0) return 0
  const refMonthStart = startOfMonth(range.endDate)
  const effectiveStart = dateMax([range.startDate, refMonthStart])
  const days = differenceInDays(range.endDate, effectiveStart) + 1
  const daysInMonth = getDaysInMonth(range.endDate)
  return (monthlyTarget * days) / daysInMonth
}

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

  const m = data.monday
  const meta = data.meta
  const t = targets ?? null
  const spend = meta?.spend ?? 0
  const calls = m?.calls ?? 0
  const qualified = m?.qualifiedCalls ?? 0
  const taken = m?.takenCalls ?? 0
  const deals = m?.deals ?? 0
  const loading = data.mondayLoading || data.metaLoading

  // Pro-rata targets for where we should be right now
  const prCalls = t?.calls ? Math.round(proRata(t.calls, range)) : undefined
  const prQualified = t?.qualifiedCalls ? Math.round(proRata(t.qualifiedCalls, range)) : undefined
  const prTaken = t?.takenCalls ? Math.round(proRata(t.takenCalls, range)) : undefined
  const prDeals = t?.deals ? Math.round(proRata(t.deals, range)) : undefined

  // Ad spend target: derived from CBC target × booked calls target (pro-rata)
  // If CBC target is €100 and booked calls target for this period is 20, expected spend = €2,000
  const prSpend = t?.cbc && prCalls ? Math.round(t.cbc * prCalls) : undefined

  // Ratios group from calculations
  const ratiosGroup = kpiGroups.find((g) => g.title === "Ratios")

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

      {/* ── KEY INSIGHTS + OPTIMISATION PROPOSAL ── */}
      <MarketingInsights
        monday={m}
        meta={meta}
        targets={t}
        range={range}
        isLoading={loading}
      />

      {/* ── REVENUE BAR ── */}
      <RevenueProgressBar
        current={revenueProgress.current}
        proRata={revenueProgress.proRata}
        monthlyTarget={revenueProgress.monthlyTarget}
        isLoading={data.mondayLoading}
      />

      {/* ── KPI CARDS ── */}
      <div className="space-y-2">
        <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-1">Volume & Costs</h2>

        {/* Ad Spend — full width with target */}
        <div>
          <KpiCard
            label="Ad Spend"
            value={spend}
            formatted={formatCurrencyDecimal(spend)}
            target={prSpend}
            targetFormatted={prSpend != null ? `${formatCurrencyDecimal(spend)} of ${formatCurrencyDecimal(prSpend)}` : undefined}
            variant="volume"
            isLoading={data.metaLoading}
          />
        </div>

        {/* Volume row: Booked | Qualified | Taken | Deals (pro-rata targets) */}
        <div className="grid grid-cols-4 gap-2">
          <KpiCard
            label="Booked Calls" value={calls} formatted={String(calls)}
            target={prCalls}
            targetFormatted={prCalls != null ? `${calls} of ${prCalls}` : undefined}
            variant="volume" isLoading={data.mondayLoading}
          />
          <KpiCard
            label="Qualified Calls" value={qualified} formatted={String(qualified)}
            target={prQualified}
            targetFormatted={prQualified != null ? `${qualified} of ${prQualified}` : undefined}
            variant="volume" isLoading={data.mondayLoading}
          />
          <KpiCard
            label="Taken Calls" value={taken} formatted={String(taken)}
            target={prTaken}
            targetFormatted={prTaken != null ? `${taken} of ${prTaken}` : undefined}
            variant="volume" isLoading={data.mondayLoading}
          />
          <KpiCard
            label="Deals" value={deals} formatted={String(deals)}
            target={prDeals}
            targetFormatted={prDeals != null ? `${deals} of ${prDeals}` : undefined}
            variant="volume" isLoading={data.mondayLoading}
          />
        </div>

        {/* Cost-per row: CBC | CQC | CTC | CPD */}
        <div className="grid grid-cols-4 gap-2">
          <KpiCard
            label="CBC" value={safeDivide(spend, calls)}
            formatted={formatCurrencyDecimal(safeDivide(spend, calls))}
            target={t?.cbc || undefined}
            targetFormatted={t?.cbc ? `${formatCurrencyDecimal(safeDivide(spend, calls))} of ${formatCurrencyDecimal(t.cbc)}` : undefined}
            variant="cost" isLoading={loading}
          />
          <KpiCard
            label="CQC" value={safeDivide(spend, qualified)}
            formatted={formatCurrencyDecimal(safeDivide(spend, qualified))}
            target={t?.cqc || undefined}
            targetFormatted={t?.cqc ? `${formatCurrencyDecimal(safeDivide(spend, qualified))} of ${formatCurrencyDecimal(t.cqc)}` : undefined}
            variant="cost" isLoading={loading}
          />
          <KpiCard
            label="CTC" value={safeDivide(spend, taken)}
            formatted={formatCurrencyDecimal(safeDivide(spend, taken))}
            target={t?.ctc || undefined}
            targetFormatted={t?.ctc ? `${formatCurrencyDecimal(safeDivide(spend, taken))} of ${formatCurrencyDecimal(t.ctc)}` : undefined}
            variant="cost" isLoading={loading}
          />
          <KpiCard
            label="CPD" value={safeDivide(spend, deals)}
            formatted={formatCurrencyDecimal(safeDivide(spend, deals))}
            target={t?.cpd || undefined}
            targetFormatted={t?.cpd ? `${formatCurrencyDecimal(safeDivide(spend, deals))} of ${formatCurrencyDecimal(t.cpd)}` : undefined}
            variant="cost" isLoading={loading}
          />
        </div>
      </div>

      {/* ── RATIOS ── */}
      {ratiosGroup && (
        <div>
          <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">{ratiosGroup.title}</h2>
          <div className="grid grid-cols-4 gap-2">
            {ratiosGroup.kpis.map((kpi) => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </div>
        </div>
      )}

      {/* ── FUNNEL + WEEKLY (50/50) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <FunnelChart
          calls={calls}
          qualified={qualified}
          taken={taken}
          deals={deals}
          revenue={m?.closedRevenue ?? 0}
          adSpend={spend}
          isLoading={loading}
        />
        <WeeklyOverview data={m?.weekly ?? []} isLoading={data.mondayLoading} />
      </div>

      {/* ── INDUSTRY ── */}
      <IndustryTable data={m?.industries ?? []} isLoading={data.mondayLoading} />
    </div>
  )
}
