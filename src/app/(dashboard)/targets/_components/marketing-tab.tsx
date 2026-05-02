"use client"

import { useMemo, useState } from "react"
import { getDaysInMonth, startOfMonth, differenceInDays, max as dateMax, subDays } from "date-fns"
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
import type { CountryKey, DateRange, StripeNewBusinessInvoice, ClosedDeal } from "@/types/targets"
import { formatCurrency } from "@/lib/targets/formatters"
import { FiltersPopover, type FilterConfig } from "@/components/ui/filters-popover"

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
  const [closer, setCloser] = useState<string>("All")
  const [stripeGapOpen, setStripeGapOpen] = useState(false)
  const { range, setRange, presets, applyPreset } = useDateRange()
  const maxPickerDate = useMemo(() => subDays(new Date(), 1), [])
  const data = useTargetsData(range, country, closer)
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
  // Closer dropdown options come from the FULL closers list (the backend keeps
  // it complete regardless of the filter so this dropdown always lists every
  // option). Everything else under "Breakdown" — closers table + insights and
  // the notUpdated counter — should reflect the active filter, otherwise the
  // KPI cards say "Anel only" while the table below still shows the team.
  const closerActive = closer !== "All"
  const closersForBreakdown = useMemo(() => {
    const all = m?.closers ?? []
    return closerActive ? all.filter((c) => c.closer === closer) : all
  }, [m?.closers, closer, closerActive])
  const notUpdatedTotal = closersForBreakdown.reduce((s, c) => s + c.notUpdated, 0)
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

  // Closer dropdown options. The backend always returns the full closers list
  // (per-closer aggregation ignores the `closer` filter), so the dropdown stays
  // populated even while a specific closer is selected. Sort alphabetically with
  // "Unassigned" pinned to the bottom — hidden if there's nothing unassigned.
  const closerOptions = useMemo(() => {
    const names = (m?.closers ?? [])
      .map((c) => c.closer)
      .filter((n): n is string => !!n && n !== "Unassigned")
      .sort((a, b) => a.localeCompare(b))
    const hasUnassigned = (m?.closers ?? []).some((c) => c.closer === "Unassigned")
    return [
      { value: "All", label: "All Closers" },
      ...names.map((n) => ({ value: n, label: n })),
      ...(hasUnassigned ? [{ value: "Unassigned", label: "Unassigned" }] : []),
    ]
  }, [m?.closers])

  const filters: FilterConfig[] = [
    {
      key: "closer",
      label: "Closer",
      value: closer,
      onChange: setCloser,
      options: closerOptions,
    },
  ]

  return (
    <div className="space-y-8">
      {/* ── FILTERS ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePicker
          startDate={range.startDate}
          endDate={range.endDate}
          onChange={setRange}
          maxDate={maxPickerDate}
        />
        <FiltersPopover filters={filters} />
        {closerActive && (
          <button
            type="button"
            onClick={() => setCloser("All")}
            className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/15 transition-colors"
            title="Click to clear the closer filter"
          >
            <span>Filtering by closer: <span className="font-semibold">{closer}</span></span>
            <span className="text-primary/70">×</span>
          </button>
        )}
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
          stripeCrossCheck={country === "all" ? m?.stripeNewBusinessRevenue : undefined}
          onGapClick={() => setStripeGapOpen(true)}
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
              notice={notUpdatedTotal > 0 ? `${notUpdatedTotal} not updated` : undefined}
              noticeTitle={notUpdatedTotal > 0 ? `${notUpdatedTotal} of these past appointments are still in Qualified / Gepland status. Counted as taken so the conversion rate isn't gamed, but flagged so closers update their statuses.` : undefined}
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
            data={closersForBreakdown}
            isLoading={data.mondayLoading}
          />
          <CloserInsights data={closersForBreakdown} isLoading={data.mondayLoading} />
        </div>
      </section>

      <StripeGapModal
        open={stripeGapOpen}
        onClose={() => setStripeGapOpen(false)}
        invoices={m?.stripeNewBusinessInvoices ?? []}
        deals={m?.closedDeals ?? []}
        mondayRevenue={revenueProgress.current}
        stripeRevenue={m?.stripeNewBusinessRevenue ?? 0}
      />
    </div>
  )
}

// ─── Stripe gap drilldown ───────────────────────────────────────────────────

function StripeGapModal({
  open, onClose, invoices, deals, mondayRevenue, stripeRevenue,
}: {
  open: boolean
  onClose: () => void
  invoices: StripeNewBusinessInvoice[]
  deals: ClosedDeal[]
  mondayRevenue: number
  stripeRevenue: number
}) {
  const [showAll, setShowAll] = useState(false)
  if (!open) return null
  const gap = stripeRevenue - mondayRevenue

  // Default view = unmatched only — that's the actual gap. Server-side fuzzy pairing
  // marks `matched: true` on rows that have a counterpart on the other side. Toggle
  // shows the full list if the user wants to verify a specific name.
  const visibleDeals = showAll ? deals : deals.filter((d) => !d.matched)
  const visibleInvoices = showAll ? invoices : invoices.filter((i) => !i.matched)
  const matchedCount = deals.filter((d) => d.matched).length
  const dealsTotalLabel = showAll ? `${deals.length} total` : `${visibleDeals.length} unmatched · ${matchedCount} matched`
  const invoicesTotalLabel = showAll ? `${invoices.length} total` : `${visibleInvoices.length} unmatched · ${matchedCount} matched`
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="bg-card border border-border rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden"
        style={{ position: "fixed", top: "10vh", left: "50%", transform: "translateX(-50%)", width: "92vw", maxWidth: "60rem", maxHeight: "80vh" }}
      >
        <div className="px-5 py-4 border-b border-border/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Monday vs Stripe — Revenue cross-check</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Showing only items without a counterpart on the other side. Matched pairs are hidden by default — toggle below to see everything.
              </p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none shrink-0">×</button>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Monday closed deals</p>
              <p className="font-mono font-medium mt-0.5">{formatCurrency(mondayRevenue)} <span className="text-muted-foreground/60 font-normal">· {deals.length}</span></p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Stripe new business</p>
              <p className="font-mono font-medium mt-0.5">{formatCurrency(stripeRevenue)} <span className="text-muted-foreground/60 font-normal">· {invoices.length}</span></p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-yellow-500/80">Gap (Stripe − Monday)</p>
              <p className={cn("font-mono font-semibold mt-0.5", gap > 0 ? "text-yellow-500" : "text-foreground")}>{formatCurrency(gap)}</p>
            </div>
          </div>
          <div className="flex items-center justify-end mt-3">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAll ? "Show only unmatched" : "Show all (incl. matched)"}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/40">
          {/* Monday side */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-border/40 bg-muted/20 flex items-center justify-between">
              <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Monday closed deals</h4>
              <span className="text-[10px] text-muted-foreground/70">{dealsTotalLabel}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {visibleDeals.length === 0 ? (
                <p className="px-4 py-6 text-xs text-muted-foreground text-center">{deals.length === 0 ? "No closed deals in this period." : "Every deal has a Stripe match. Nothing to fix."}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b border-border/40">
                    <tr>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Date</th>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Lead · Company · Closer</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDeals.map((d) => (
                      <tr key={d.mondayItemId} className={cn("border-b border-border/20 last:border-0 hover:bg-muted/30", d.matched && "opacity-60")}>
                        <td className="py-2 px-4 font-mono text-muted-foreground">{d.dateDeal || "—"}</td>
                        <td className="py-2 px-4 truncate max-w-[220px]">
                          <div className="truncate">{d.name}</div>
                          {d.companyName && <div className="text-[10px] text-muted-foreground/70 truncate">{d.companyName}</div>}
                          {d.closer && <div className="text-[10px] text-muted-foreground/70 truncate">{d.closer}</div>}
                        </td>
                        <td className="py-2 px-4 text-right font-mono font-medium">{formatCurrency(d.dealValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Stripe side */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-border/40 bg-muted/20 flex items-center justify-between">
              <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Stripe new-business invoices</h4>
              <span className="text-[10px] text-muted-foreground/70">{invoicesTotalLabel}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {visibleInvoices.length === 0 ? (
                <p className="px-4 py-6 text-xs text-muted-foreground text-center">{invoices.length === 0 ? "No Stripe new-business invoices in this period." : "Every invoice has a Monday match. Nothing to fix."}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b border-border/40">
                    <tr>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Date</th>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Customer / Invoice</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.map((inv) => (
                      <tr
                        key={`${inv.invoiceNumber}-${inv.date}`}
                        onClick={inv.hostedUrl ? () => window.open(inv.hostedUrl!, "_blank", "noopener,noreferrer") : undefined}
                        className={cn(
                          "border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors",
                          inv.hostedUrl && "cursor-pointer",
                          inv.matched && "opacity-60",
                        )}
                      >
                        <td className="py-2 px-4 font-mono text-muted-foreground">{inv.date}</td>
                        <td className="py-2 px-4 truncate max-w-[200px]">
                          <div className="truncate">{inv.customerName}</div>
                          {inv.invoiceNumber && <div className={cn("text-[10px] font-mono truncate", inv.hostedUrl ? "text-primary" : "text-muted-foreground/70")}>{inv.invoiceNumber}</div>}
                        </td>
                        <td className="py-2 px-4 text-right font-mono font-medium">{formatCurrency(inv.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
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
