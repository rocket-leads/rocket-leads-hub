"use client"

import { useState } from "react"
import { getDaysInMonth, startOfMonth, differenceInDays, max as dateMax } from "date-fns"
import { useDateRange } from "../_hooks/use-date-range"
import { useTargetsData } from "../_hooks/use-targets-data"
import { useKpiCalculations } from "../_hooks/use-kpi-calculations"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { KpiCard } from "./kpi-card"
import { DateRangePicker } from "./date-range-picker"
import { RevenueProgressBar } from "./revenue-progress-bar"
import { WeeklyOverview } from "./weekly-overview"
import { IndustryTable } from "./industry-table"
import { ClosersTable } from "./closers-table"
import { CloserInsights } from "./closer-insights"
import { MarketingInsights } from "./marketing-insights"
import { PulseBanner } from "./pulse-banner"
import { HeroPillars } from "./hero-pillars"
import { cn } from "@/lib/utils"
import { formatCurrencyDecimal, safeDivide } from "@/lib/targets/formatters"
import { deriveTargets } from "@/lib/targets/calculations"
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
  const { range, setRange, presets, applyPreset } = useDateRange()
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

  // Volume targets (calls/qualified/taken) are derived from ad-spend (= deals × cpd)
  // divided by the relevant cost ceiling. Only deals & revenue come straight from Settings.
  const derivedT = deriveTargets(t)
  const prCalls = derivedT.calls > 0 ? Math.round(proRata(derivedT.calls, range)) : undefined
  const prQualified = derivedT.qualifiedCalls > 0 ? Math.round(proRata(derivedT.qualifiedCalls, range)) : undefined
  const prTaken = derivedT.takenCalls > 0 ? Math.round(proRata(derivedT.takenCalls, range)) : undefined
  const prDeals = t?.deals ? Math.round(proRata(t.deals, range)) : undefined

  // Ad spend target = pro-rata of (deals × cpd)
  const prSpend = derivedT.adSpend > 0 ? Math.round(proRata(derivedT.adSpend, range)) : undefined

  // Ratios group from calculations
  const ratiosGroup = kpiGroups.find((g) => g.title === "Ratios")

  return (
    <div className="space-y-8">
      {/* ── FILTERS ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePicker
          startDate={range.startDate}
          endDate={range.endDate}
          onChange={setRange}
        />
        <div className="flex gap-1 flex-wrap">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className="h-8 px-2.5 text-[11px] rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
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

      {/* ── SECTION 1 — SUMMARY ── */}
      <section className="space-y-3">
        <SectionHeader title="Summary" subtitle="One-second status & insights" />
        <PulseBanner monday={m} meta={meta} targets={t} range={range} isLoading={loading} />
        <HeroPillars monday={m} meta={meta} targets={t} isLoading={loading} />
        <RevenueProgressBar
          current={revenueProgress.current}
          proRata={revenueProgress.proRata}
          monthlyTarget={revenueProgress.monthlyTarget}
          isLoading={data.mondayLoading}
        />
        <MarketingInsights
          monday={m}
          meta={meta}
          targets={t}
          range={range}
          isLoading={loading}
        />
      </section>

      {/* ── SECTION 2 — METRICS ── */}
      <section className="space-y-3">
        <SectionHeader title="Metrics" subtitle="Volume, costs & ratios" />

        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-1">Volume & Costs</h3>

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

          {/* Volume row: Booked | Qualified | Taken | Deals */}
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

        {ratiosGroup && (
          <div className="pt-1">
            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">{ratiosGroup.title}</h3>
            <div className="grid grid-cols-4 gap-2">
              {ratiosGroup.kpis.map((kpi) => (
                <KpiCard key={kpi.label} {...kpi} />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── SECTION 3 — BREAKDOWN ── */}
      <section className="space-y-3">
        <SectionHeader title="Breakdown" subtitle="Trends, industries & team performance" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <WeeklyOverview data={m?.weekly ?? []} isLoading={data.mondayLoading} />
          <IndustryTable data={m?.industries ?? []} isLoading={data.mondayLoading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ClosersTable
            data={m?.closers ?? []}
            isLoading={data.mondayLoading}
          />
          <CloserInsights data={m?.closers ?? []} isLoading={data.mondayLoading} />
        </div>
      </section>
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 pb-2 border-b border-border/30">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {subtitle && (
          <span className="text-xs text-muted-foreground hidden sm:inline">· {subtitle}</span>
        )}
      </div>
    </div>
  )
}
