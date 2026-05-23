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
import { DismissButton } from "@/components/ui/dismiss-button"
import { formatCurrencyDecimal, safeDivide } from "@/lib/targets/formatters"
import { deriveTargets } from "@/lib/targets/calculations"
import type { CountryKey, DateRange, StripeNewBusinessInvoice, ClosedDeal } from "@/types/targets"
import { formatCurrency } from "@/lib/targets/formatters"
import { FiltersPopover, type FilterConfig } from "@/components/ui/filters-popover"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { DictionaryKey } from "@/lib/i18n/dictionary"

/** Country segmented control. NL/BE/DE are country codes — no translation —
 *  but "All" / "Other" flip with locale. */
const COUNTRY_SHAPE: Array<{ key: CountryKey; labelKey: DictionaryKey | null; label: string }> = [
  { key: "all", labelKey: "targets.country.all", label: "All" },
  { key: "nl", labelKey: null, label: "NL" },
  { key: "be", labelKey: null, label: "BE" },
  { key: "de", labelKey: null, label: "DE" },
  { key: "other", labelKey: "targets.country.other", label: "Other" },
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
  const locale = useLocale()
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
  // Renamed from `t` to `tgt` to free the `t` identifier for the i18n
  // `t(key, locale)` lookup imported above.
  const tgt = targets ?? null
  const spend = meta?.spend ?? 0
  const calls = m?.calls ?? 0
  const qualified = m?.qualifiedCalls ?? 0
  const taken = m?.takenCalls ?? 0
  const deals = m?.deals ?? 0
  // Opt-ins lives on a separate Monday board with no country attribution.
  // The fetcher populates the value only on the "all" bucket, so we show
  // the tile only when the user is on the All-countries view — under a
  // country filter the value would always be 0 and the cost-per number
  // meaningless.
  const optIns = country === "all" ? m?.optIns ?? 0 : 0
  const cpOptIn = country === "all" ? safeDivide(spend, optIns) : 0
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
  // True while every Monday-driven tile is rendering MTD-range numbers as
  // placeholder for the still-loading selected range. Surface as a small
  // amber pill on each affected tile so the user can tell the value isn't
  // authoritative yet.
  const mondayMtdPlaceholder = data.mondayShowingMtdFallback

  // Volume targets (opt-ins/calls/qualified/taken) are derived from ad-spend
  // (= deals × cpd) divided by the relevant cost ceiling. Only deals & revenue
  // come straight from Settings. Booking rate target = cpOptIn / cbc.
  const derivedT = deriveTargets(tgt)
  const prOptIns = derivedT.optIns > 0 ? Math.round(proRata(derivedT.optIns, range)) : undefined
  const prCalls = derivedT.calls > 0 ? Math.round(proRata(derivedT.calls, range)) : undefined
  const prQualified = derivedT.qualifiedCalls > 0 ? Math.round(proRata(derivedT.qualifiedCalls, range)) : undefined
  const prTaken = derivedT.takenCalls > 0 ? Math.round(proRata(derivedT.takenCalls, range)) : undefined
  const prDeals = tgt?.deals ? Math.round(proRata(tgt.deals, range)) : undefined

  // Ad spend target = pro-rata of (deals × cpd)
  const prSpend = derivedT.adSpend > 0 ? Math.round(proRata(derivedT.adSpend, range)) : undefined

  // Appointment booking rate = booked calls / opt-ins. Target is a ratio (not
  // pro-rata-able) — cpOptIn / cbc from Settings. The actual value uses live
  // calls / optIns. Both are only meaningful on the "all" country view since
  // opt-ins has no country attribution.
  const bookingRate = optIns > 0 ? (calls / optIns) * 100 : 0
  const bookingRateTarget = derivedT.bookingRate > 0 ? derivedT.bookingRate * 100 : undefined

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
      { value: "All", label: t("targets.filter.all_closers", locale) },
      ...names.map((n) => ({ value: n, label: n })),
      ...(hasUnassigned ? [{ value: "Unassigned", label: t("targets.filter.unassigned", locale) }] : []),
    ]
  }, [m?.closers, locale])

  const filters: FilterConfig[] = [
    {
      key: "closer",
      label: t("targets.filter.closer", locale),
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
        {closerActive && (() => {
          // Bold the closer name inside the pill text — sentinel split keeps
          // the dictionary entry natural ("Filteren op closer: {name}").
          const pillText = t("targets.filter.active_closer", locale, { name: "__CLOSER__" })
          const [before, after] = pillText.split("__CLOSER__")
          return (
            <button
              type="button"
              onClick={() => setCloser("All")}
              className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/15 transition-colors"
              title={t("targets.filter.clear_closer", locale)}
            >
              <span>{before}<span className="font-semibold">{closer}</span>{after}</span>
              <span className="text-primary/70">×</span>
            </button>
          )
        })()}
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
          {COUNTRY_SHAPE.map(({ key, labelKey, label }) => (
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
              {labelKey ? t(labelKey, locale) : label}
            </button>
          ))}
        </div>
      </div>

      {/* ── SECTION 1 — SUMMARY ── */}
      <section className="space-y-3">
        <SectionHeader title={t("targets.section.summary.title", locale)} subtitle={t("targets.section.summary.subtitle", locale)} />
        <PulseBanner monday={m} meta={meta} targets={tgt} range={range} isLoading={loading} />
        <HeroPillars monday={m} meta={meta} targets={tgt} isLoading={loading} />
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
          targets={tgt}
          range={range}
          isLoading={loading}
        />
      </section>

      {/* ── SECTION 2 — METRICS ── */}
      <section className="space-y-3">
        <SectionHeader title={t("targets.section.metrics.title", locale)} subtitle={t("targets.section.metrics.subtitle", locale)} />

        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-1">{t("targets.section.volume_costs", locale)}</h3>

          {/* Ad Spend — full width with target */}
          <div>
            <KpiCard
              label="Ad Spend"
              value={spend}
              formatted={formatCurrencyDecimal(spend)}
              target={prSpend}
              targetFormatted={prSpend != null ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(spend), target: formatCurrencyDecimal(prSpend) }) : undefined}
              variant="volume"
              isLoading={data.metaLoading}
            />
          </div>

          {/* Volume + Cost + Ratio funnel — left column carries the opt-in
              metrics (volume / cost / booking rate), the remaining 4 columns
              are the existing booked → qualified → taken → deals funnel.
              Opt-in metrics are country-agnostic; they hide off "all" but the
              4-col remainder still renders so country filters keep working. */}
          {/* Row 1: Opt-ins | Booked | Qualified | Taken | Deals */}
          <div className={cn("grid gap-2", country === "all" ? "grid-cols-5" : "grid-cols-4") }>
            {country === "all" && (
              <KpiCard
                label={t("targets.kpi.opt_ins", locale)}
                value={optIns} formatted={String(optIns)}
                target={prOptIns}
                targetFormatted={prOptIns != null ? t("targets.kpi.target_of", locale, { value: String(optIns), target: String(prOptIns) }) : undefined}
                variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
              />
            )}
            <KpiCard
              label="Booked Calls" value={calls} formatted={String(calls)}
              target={prCalls}
              targetFormatted={prCalls != null ? t("targets.kpi.target_of", locale, { value: String(calls), target: String(prCalls) }) : undefined}
              variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
            <KpiCard
              label="Qualified Calls" value={qualified} formatted={String(qualified)}
              target={prQualified}
              targetFormatted={prQualified != null ? t("targets.kpi.target_of", locale, { value: String(qualified), target: String(prQualified) }) : undefined}
              variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
            <KpiCard
              label="Taken Calls" value={taken} formatted={String(taken)}
              target={prTaken}
              targetFormatted={prTaken != null ? t("targets.kpi.target_of", locale, { value: String(taken), target: String(prTaken) }) : undefined}
              notice={notUpdatedTotal > 0 ? t("targets.kpi.not_updated", locale, { n: String(notUpdatedTotal) }) : undefined}
              noticeTitle={notUpdatedTotal > 0 ? t("targets.kpi.not_updated_title", locale, { n: String(notUpdatedTotal) }) : undefined}
              variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
            <KpiCard
              label="Deals" value={deals} formatted={String(deals)}
              target={prDeals}
              targetFormatted={prDeals != null ? t("targets.kpi.target_of", locale, { value: String(deals), target: String(prDeals) }) : undefined}
              variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
          </div>

          {/* Row 2: Cost per Opt-in | CBC | CQC | CTC | CPD */}
          <div className={cn("grid gap-2", country === "all" ? "grid-cols-5" : "grid-cols-4") }>
            {country === "all" && (
              <KpiCard
                label={t("targets.kpi.cost_per_opt_in", locale)}
                value={cpOptIn}
                formatted={formatCurrencyDecimal(cpOptIn)}
                target={tgt?.cpOptIn || undefined}
                targetFormatted={tgt?.cpOptIn ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(cpOptIn), target: formatCurrencyDecimal(tgt.cpOptIn) }) : undefined}
                variant="cost" isLoading={loading} isMtdPlaceholder={mondayMtdPlaceholder}
              />
            )}
            <KpiCard
              label="CBC" value={safeDivide(spend, calls)}
              formatted={formatCurrencyDecimal(safeDivide(spend, calls))}
              target={tgt?.cbc || undefined}
              targetFormatted={tgt?.cbc ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(safeDivide(spend, calls)), target: formatCurrencyDecimal(tgt.cbc) }) : undefined}
              variant="cost" isLoading={loading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
            <KpiCard
              label="CQC" value={safeDivide(spend, qualified)}
              formatted={formatCurrencyDecimal(safeDivide(spend, qualified))}
              target={tgt?.cqc || undefined}
              targetFormatted={tgt?.cqc ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(safeDivide(spend, qualified)), target: formatCurrencyDecimal(tgt.cqc) }) : undefined}
              variant="cost" isLoading={loading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
            <KpiCard
              label="CTC" value={safeDivide(spend, taken)}
              formatted={formatCurrencyDecimal(safeDivide(spend, taken))}
              target={tgt?.ctc || undefined}
              targetFormatted={tgt?.ctc ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(safeDivide(spend, taken)), target: formatCurrencyDecimal(tgt.ctc) }) : undefined}
              variant="cost" isLoading={loading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
            <KpiCard
              label="CPD" value={safeDivide(spend, deals)}
              formatted={formatCurrencyDecimal(safeDivide(spend, deals))}
              target={tgt?.cpd || undefined}
              targetFormatted={tgt?.cpd ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(safeDivide(spend, deals)), target: formatCurrencyDecimal(tgt.cpd) }) : undefined}
              variant="cost" isLoading={loading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
          </div>
        </div>

        {ratiosGroup && (
          <div className="pt-1">
            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">{ratiosGroup.title}</h3>
            {/* Row 3 (ratios): Appointment Booking Rate | qualRate | showUpRate | convRate | roas */}
            <div className={cn("grid gap-2", country === "all" ? "grid-cols-5" : "grid-cols-4") }>
              {country === "all" && (
                <KpiCard
                  label={t("targets.kpi.appointment_booking_rate", locale)}
                  value={bookingRate}
                  formatted={`${bookingRate.toFixed(1)}%`}
                  target={bookingRateTarget}
                  targetFormatted={bookingRateTarget != null ? t("targets.kpi.target_of", locale, { value: `${bookingRate.toFixed(1)}%`, target: `${bookingRateTarget.toFixed(0)}%` }) : undefined}
                  variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
                />
              )}
              {ratiosGroup.kpis.map((kpi) => (
                // Ratios mix Monday volume with Meta spend; when Monday is
                // serving MTD as placeholder the ratio is partially wrong
                // (MTD leads ÷ selected-range spend) — flag it so the CM
                // doesn't trust the number yet.
                <KpiCard key={kpi.label} {...kpi} isMtdPlaceholder={mondayMtdPlaceholder} />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── SECTION 3 — BREAKDOWN ── */}
      <section className="space-y-3">
        <SectionHeader title={t("targets.section.breakdown.title", locale)} subtitle={t("targets.section.breakdown.subtitle", locale)} />

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
  const locale = useLocale()
  const [showAll, setShowAll] = useState(false)
  if (!open) return null
  const gap = stripeRevenue - mondayRevenue

  // Default view = unmatched only — that's the actual gap. Server-side fuzzy pairing
  // marks `matched: true` on rows that have a counterpart on the other side. Toggle
  // shows the full list if the user wants to verify a specific name.
  const visibleDeals = showAll ? deals : deals.filter((d) => !d.matched)
  const visibleInvoices = showAll ? invoices : invoices.filter((i) => !i.matched)
  const matchedCount = deals.filter((d) => d.matched).length
  const dealsTotalLabel = showAll
    ? t("targets.stripe.count.total", locale, { n: String(deals.length) })
    : t("targets.stripe.count.split", locale, { unmatched: String(visibleDeals.length), matched: String(matchedCount) })
  const invoicesTotalLabel = showAll
    ? t("targets.stripe.count.total", locale, { n: String(invoices.length) })
    : t("targets.stripe.count.split", locale, { unmatched: String(visibleInvoices.length), matched: String(matchedCount) })
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
              <h3 className="text-sm font-semibold">{t("targets.stripe.title", locale)}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {t("targets.stripe.subtitle", locale)}
              </p>
            </div>
            <DismissButton onClick={onClose} stopPropagation={false} />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{t("targets.stripe.monday_closed_deals", locale)}</p>
              <p className="font-mono font-medium mt-0.5">{formatCurrency(mondayRevenue)} <span className="text-muted-foreground/60 font-normal">· {deals.length}</span></p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{t("targets.stripe.stripe_new_business", locale)}</p>
              <p className="font-mono font-medium mt-0.5">{formatCurrency(stripeRevenue)} <span className="text-muted-foreground/60 font-normal">· {invoices.length}</span></p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-yellow-500/80">{t("targets.stripe.gap", locale)}</p>
              <p className={cn("font-mono font-semibold mt-0.5", gap > 0 ? "text-yellow-500" : "text-foreground")}>{formatCurrency(gap)}</p>
            </div>
          </div>
          <div className="flex items-center justify-end mt-3">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAll ? t("targets.stripe.show_unmatched", locale) : t("targets.stripe.show_all", locale)}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/40">
          {/* Monday side */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-border/40 bg-muted/20 flex items-center justify-between">
              <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("targets.stripe.monday_closed_deals", locale)}</h4>
              <span className="text-[10px] text-muted-foreground/70">{dealsTotalLabel}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {visibleDeals.length === 0 ? (
                <p className="px-4 py-6 text-xs text-muted-foreground text-center">{deals.length === 0 ? t("targets.stripe.empty.deals_none", locale) : t("targets.stripe.empty.deals_all_matched", locale)}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b border-border/40">
                    <tr>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">{t("targets.stripe.col.date", locale)}</th>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">{t("targets.stripe.col.lead_company_closer", locale)}</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">{t("targets.stripe.col.value", locale)}</th>
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
              <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("targets.stripe.stripe_invoices_title", locale)}</h4>
              <span className="text-[10px] text-muted-foreground/70">{invoicesTotalLabel}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {visibleInvoices.length === 0 ? (
                <p className="px-4 py-6 text-xs text-muted-foreground text-center">{invoices.length === 0 ? t("targets.stripe.empty.invoices_none", locale) : t("targets.stripe.empty.invoices_all_matched", locale)}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b border-border/40">
                    <tr>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">{t("targets.stripe.col.date", locale)}</th>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">{t("targets.stripe.col.customer_invoice", locale)}</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">{t("targets.stripe.col.amount", locale)}</th>
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
