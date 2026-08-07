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
import { PulseBanner } from "./pulse-banner"
import { HeroPillars } from "./hero-pillars"
import { MarketingHero } from "./marketing-hero"
import { MarketingStatRow } from "./marketing-stat-row"
import { cn } from "@/lib/utils"
import { AlertTriangle } from "lucide-react"
import { DismissButton } from "@/components/ui/dismiss-button"
import { formatCurrencyDecimal, safeDivide } from "@/lib/targets/formatters"
import { deriveTargets } from "@/lib/targets/calculations"
import type { CountryKey, PlatformKey, DateRange, StripeNewBusinessInvoice, ClosedDeal } from "@/types/targets"
import { formatCurrency } from "@/lib/targets/formatters"
import { ConditionFilter } from "@/components/ui/condition-filter"
import { type FilterConfig } from "@/components/ui/filters-popover"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

/** Static filter options for the condition-filter popover. Country + Platform
 *  are code values (no translation); "All …" is the cleared/options[0] value. */
const COUNTRY_FILTER_OPTIONS = [
  { value: "all", label: "All countries" },
  { value: "nl", label: "Netherlands" },
  { value: "be", label: "Belgium" },
  { value: "de", label: "Germany" },
]
const PLATFORM_FILTER_OPTIONS = [
  { value: "all", label: "All platforms" },
  { value: "meta", label: "Meta" },
  { value: "google", label: "Google" },
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
  const [platform, setPlatform] = useState<PlatformKey>("all")
  const [closer, setCloser] = useState<string>("All")
  // Marketing vs Sales lens for the KPI matrix (metrics / costs / ratios rows only
  // - the Breakdown section below always stays Sales-basis). The two lenses answer
  // different questions and re-base "Booked calls":
  //   Marketing = "what did the ads produce?" → Booked = leads CREATED in range,
  //               shows Opt-ins · Booked · Deals, no Taken/Show-up.
  //   Sales     = "what got scheduled & showed up?" → Booked = appointments in
  //               range (datum_afspraak), shows Booked · Taken · Deals + Show-up.
  const [view, setView] = useState<"marketing" | "sales">("marketing")
  const [stripeGapOpen, setStripeGapOpen] = useState(false)
  const { range, setRange, presets, applyPreset } = useDateRange()
  const maxPickerDate = useMemo(() => subDays(new Date(), 1), [])
  const data = useTargetsData(range, country, closer, platform)
  const { data: targets } = useTargetsConfig()
  const { kpiGroups, closedProgress, collectedProgress } = useKpiCalculations(
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
  // When Meta data is missing (token failed, account empty, fetch errored)
  // every cost-per metric reads as €0.00 with a green progress bar - looks
  // like "we're killing it" but actually means "we have no data". Treat
  // spend=0 as "no meta signal" so the cost cards render `-` instead of a
  // misleading green zero. `data.metaError` and `data.metaLoading === false`
  // both feed this check via the upstream hook.
  const hasMetaSpend = !data.metaLoading && spend > 0
  const fmtCost = (formatted: string) => (hasMetaSpend ? formatted : "-")
  const calls = m?.calls ?? 0
  // Qualification stage dropped 2026-05-27 - the funnel is now Opt-in →
  // Booked → Taken → Deal. cancellations + noShows expose how many booked
  // calls didn't happen; the rest are taken.
  const cancellations = m?.cancellations ?? 0
  const noShows = m?.noShows ?? 0
  const taken = m?.takenCalls ?? 0
  const deals = m?.deals ?? 0
  // Per-deal averages + their auto-derived targets (target revenue ÷ target deals).
  const closedRevenue = m?.closedRevenue ?? 0
  const collectedRevenue = m?.collectedRevenue ?? 0
  const avgDealValue = safeDivide(closedRevenue, deals)
  const avgCollectedPerDeal = safeDivide(collectedRevenue, deals)
  const avgDealTarget = safeDivide(tgt?.revenue ?? 0, tgt?.deals ?? 0)
  const avgCollectedTarget = safeDivide(tgt?.collectedRevenue ?? 0, tgt?.deals ?? 0)
  // Opt-ins lives on a separate Monday board with no country attribution.
  // The fetcher populates the value only on the "all" bucket, so we show
  // the tile only when the user is on the All-countries view - under a
  // country filter the value would always be 0 and the cost-per number
  // meaningless.
  const optIns = country === "all" ? m?.optIns ?? 0 : 0
  const cpOptIn = country === "all" ? safeDivide(spend, optIns) : 0
  // Closer dropdown options come from the FULL closers list (the backend keeps
  // it complete regardless of the filter so this dropdown always lists every
  // option). Everything else under "Breakdown" - closers table + insights and
  // the notUpdated counter - should reflect the active filter, otherwise the
  // KPI cards say "Anel only" while the table below still shows the team.
  const closerActive = closer !== "All"
  const closersForBreakdown = useMemo(() => {
    const all = m?.closers ?? []
    return closerActive ? all.filter((c) => c.closer === closer) : all
  }, [m?.closers, closer, closerActive])
  // Not-updated + upcoming come straight off the top-level bucket (filter-scoped
  // server-side, same as calls/taken/noShows/cancellations) so the breakdown
  // reconciles exactly: Booked = Taken + no-shows + cancellations + not-updated
  // + upcoming. (The old closer-derived sum could drift from the scoped calls.)
  const notUpdated = m?.notUpdated ?? 0
  const upcoming = m?.upcoming ?? 0
  const loading = data.mondayLoading || data.metaLoading
  // True while every Monday-driven tile is rendering MTD-range numbers as
  // placeholder for the still-loading selected range. Surface as a small
  // amber pill on each affected tile so the user can tell the value isn't
  // authoritative yet.
  const mondayMtdPlaceholder = data.mondayShowingMtdFallback

  // Volume targets (opt-ins/calls/taken) are derived from ad-spend (= deals
  // × cpd) divided by the relevant cost ceiling. Only deals & revenue come
  // straight from Settings. Booking rate target = cpOptIn / cbc. Show-up
  // rate target = cbc / ctc.
  const derivedT = deriveTargets(tgt)
  const prOptIns = derivedT.optIns > 0 ? Math.round(proRata(derivedT.optIns, range)) : undefined
  const prCalls = derivedT.calls > 0 ? Math.round(proRata(derivedT.calls, range)) : undefined
  const prTaken = derivedT.takenCalls > 0 ? Math.round(proRata(derivedT.takenCalls, range)) : undefined
  const prDeals = tgt?.deals ? Math.round(proRata(tgt.deals, range)) : undefined

  // Ad spend target = pro-rata of (deals × cpd)
  const prSpend = derivedT.adSpend > 0 ? Math.round(proRata(derivedT.adSpend, range)) : undefined

  // ── View-aware Booked + ratios ────────────────────────────────────────────
  // Booked calls: Marketing counts leads CREATED in range (what the ads produced);
  // Sales counts appointments scheduled in range (datum_afspraak, = `calls`).
  // Every cost/ratio below keys off this single figure so each lens is internally
  // consistent.
  // Marketing Booked = leads CREATED in range that booked a call (its own
  // creation-date cohort, decomposing cleanly into the status chips below).
  // Sales Booked = appointments scheduled in range (datum_afspraak).
  const isMarketing = view === "marketing"
  const booked = isMarketing ? (m?.mktBooked ?? 0) : calls
  const mktUpcoming = m?.mktUpcoming ?? 0
  const mktNotUpdated = m?.mktNotUpdated ?? 0
  const mktNoShowCancel = m?.mktNoShowCancel ?? 0
  // Top-right chips on the Booked Calls card: a date-basis caption in both
  // lenses, plus (Marketing only) the status breakdown of the creation-date
  // cohort - upcoming / not-updated / no-show+cancel. mktBooked = taken +
  // not-updated + no-show/cancel + upcoming, so these + taken reconcile.
  type BookedNotice = { label: string; tone?: "warn" | "danger" | "muted"; title?: string }
  const bookedNotices = (isMarketing
    ? ([
        { label: "creation date", tone: "muted", title: "Leads created in this period that booked a call - what the ads produced. Booked = taken + not-updated + no-show/cancel + upcoming." },
        mktUpcoming > 0 ? { label: `${mktUpcoming} upcoming`, tone: "muted", title: "Future appointments - haven't happened yet." } : null,
        mktNotUpdated > 0 ? { label: `${mktNotUpdated} not updated`, tone: "warn", title: "Past appointments the closer hasn't recorded an outcome for yet." } : null,
        mktNoShowCancel > 0 ? { label: `${mktNoShowCancel} no-show / cancel`, tone: "danger", title: "Booked calls that dropped off before a taken call." } : null,
      ] as Array<BookedNotice | null>)
    : ([
        { label: "appointment date", tone: "muted", title: "Calls scheduled in this period, counted on the appointment date." },
      ] as Array<BookedNotice | null>)
  ).filter((n): n is BookedNotice => n !== null)
  // Marketing ratios: Booking rate = Booked ÷ Opt-ins, Conversion = Deals ÷
  // Booked. Sales ratios (Show-up, Conversion, ROAS) reuse the shared ratio
  // calcs unchanged, so they're not recomputed here. Targets are the same
  // Settings ceilings in both lenses (Roy: "targets blijven altijd hetzelfde"),
  // so we keep the red/green progress bars on the Marketing cards too.
  const bookingRate = optIns > 0 ? (booked / optIns) * 100 : 0
  const mktConvRate = booked > 0 ? (deals / booked) * 100 : 0
  const bookingRateTarget = derivedT.bookingRate > 0 ? derivedT.bookingRate * 100 : undefined
  const convRateTarget = derivedT.convRate > 0 ? derivedT.convRate * 100 : undefined
  // Grid columns: Sales is always 3. Marketing is 3 on the All-countries view
  // (Opt-ins · Booked · Deals) but drops to 2 under a country filter, since
  // opt-ins has no country attribution and hides.
  const showOptInCol = isMarketing && country === "all"
  const matrixCols = isMarketing ? (country === "all" ? "grid-cols-3" : "grid-cols-2") : "grid-cols-3"

  // Ratios group from calculations (Show-up · Conversion · ROAS, Sales-basis).
  // Sales view renders these as-is; Marketing view reuses only the ROAS card
  // (identical in both lenses) and hand-rolls Booking rate + Conversion.
  const ratiosGroup = kpiGroups.find((g) => g.title === "Ratios")
  const roasKpi = ratiosGroup?.kpis.find((k) => k.label === "ROAS")

  // Closer dropdown options. The backend always returns the full closers list
  // (per-closer aggregation ignores the `closer` filter), so the dropdown stays
  // populated even while a specific closer is selected. Sort alphabetically with
  // "Unassigned" pinned to the bottom - hidden if there's nothing unassigned.
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
      key: "platform",
      label: "Platform",
      value: platform,
      onChange: (v) => setPlatform(v as PlatformKey),
      options: PLATFORM_FILTER_OPTIONS,
    },
    {
      key: "country",
      label: "Country",
      value: country,
      onChange: (v) => setCountry(v as CountryKey),
      options: COUNTRY_FILTER_OPTIONS,
    },
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
        <ConditionFilter filters={filters} />
        <div className="flex gap-1.5 flex-wrap ml-auto">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className="chip h-9"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Platform / spend-source transparency. The AD SPEND card blends Meta +
          Google into one number, so on its own you can't tell whether Google is
          contributing. Always break it out under the "All platforms" view so a
          silent Google €0 (empty/unshared sheet) is obvious rather than looking
          like Meta is the whole story. Error + single-country-exclusion keep
          their explicit amber notes. */}
      {data.googleAdsError ? (
        <div className="-mt-5 text-[11px] text-amber-600 inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Google Ads spend unavailable - share the Actual sheet tab (Viewer) with the Hub&apos;s Google service account.
        </div>
      ) : data.googleExcludedForCountry ? (
        <div className="-mt-5 text-[11px] text-amber-600 inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {`Google Ads spend (${formatCurrency(data.googleSpend)}) is hidden under a single-country filter - it has no country attribution. Switch Country to "All" to include it.`}
        </div>
      ) : platform === "all" && !loading && (data.metaSpend > 0 || data.googleSpend > 0) ? (
        <div className="-mt-5 text-[11px] text-muted-foreground px-1 inline-flex items-center gap-1.5 flex-wrap">
          <span className="font-medium">Ad spend source:</span>
          <span className="tabular-nums">Meta {formatCurrency(data.metaSpend)}</span>
          <span>+</span>
          <span className="tabular-nums">Google {formatCurrency(data.googleSpend)}</span>
          {data.googleSpend === 0 && (
            <span className="text-amber-600 inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Google €0 for this range - check the Actual sheet is filled + shared.
            </span>
          )}
        </div>
      ) : null}

      {/* ── HERO - the money story up top (ROAS + weekly revenue trend) ── */}
      <MarketingHero monday={m} meta={meta} targets={tgt} range={range} isLoading={loading} />

      {/* ── SECTION 1 - SUMMARY ── */}
      <section className="space-y-3">
        <SectionHeader title={t("targets.section.summary.title", locale)} />
        <MarketingStatRow monday={m} targets={tgt} range={range} isLoading={data.mondayLoading} />
        <PulseBanner monday={m} meta={meta} targets={tgt} range={range} isLoading={loading} />
        <HeroPillars monday={m} meta={meta} targets={tgt} isLoading={loading} />
        {/* Each revenue pro-rata bar sits on one line with its per-deal average -
            closely related (avg = revenue ÷ deals). Avg targets auto-derive from
            Settings (target revenue ÷ target deals). */}
        <div className="space-y-3">
          {/* Cash collected - the money actually in the door. */}
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
            <RevenueProgressBar
              label="Cash collected"
              current={collectedProgress.current}
              proRata={collectedProgress.proRata}
              monthlyTarget={collectedProgress.monthlyTarget}
              isLoading={data.mondayLoading}
            />
            <KpiCard
              label="Avg Collected / Deal"
              value={deals > 0 ? avgCollectedPerDeal : null}
              formatted={deals > 0 ? formatCurrency(avgCollectedPerDeal) : "-"}
              target={avgCollectedTarget || undefined}
              targetFormatted={avgCollectedTarget ? t("targets.kpi.target_of", locale, { value: formatCurrency(avgCollectedPerDeal), target: formatCurrency(avgCollectedTarget) }) : undefined}
              variant="volume"
              isLoading={data.mondayLoading}
            />
          </div>
          {/* Closed deal value - total contract value; carries the Stripe cross-check. */}
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
            <RevenueProgressBar
              label="Closed deal revenue"
              current={closedProgress.current}
              proRata={closedProgress.proRata}
              monthlyTarget={closedProgress.monthlyTarget}
              isLoading={data.mondayLoading}
              stripeCrossCheck={country === "all" ? m?.stripeNewBusinessRevenue : undefined}
              onGapClick={() => setStripeGapOpen(true)}
            />
            <KpiCard
              label="Avg Deal Value"
              value={deals > 0 ? avgDealValue : null}
              formatted={deals > 0 ? formatCurrency(avgDealValue) : "-"}
              target={avgDealTarget || undefined}
              targetFormatted={avgDealTarget ? t("targets.kpi.target_of", locale, { value: formatCurrency(avgDealValue), target: formatCurrency(avgDealTarget) }) : undefined}
              variant="volume"
              isLoading={data.mondayLoading}
            />
          </div>
        </div>
      </section>

      {/* ── SECTION 2 - METRICS ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <SectionHeader title={t("targets.section.metrics.title", locale)} />
          {/* Marketing / Sales lens switch. Re-bases the three KPI rows below
              (Booked = leads-created vs appointments-scheduled). Pill-selector
              toggle chips - the one raw-button pattern the house rules allow. */}
          <div className="inline-flex items-center rounded-lg border border-border/70 bg-muted/30 p-0.5" role="group" aria-label={locale === "nl" ? "Marketing- of sales-weergave" : "Marketing or sales view"}>
            {(["marketing", "sales"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn(
                  "h-8 rounded-md px-3.5 text-sm font-medium capitalize transition-colors",
                  view === v
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-1">{t("targets.section.volume_costs", locale)}</h3>

          {/* Ad Spend - full width with target */}
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

          {/* Row 1 (metrics), view-aware:
              Marketing → Opt-ins · Booked (leads created in range) · Deals
              Sales     → Booked (appointments scheduled) · Taken · Deals
              Opt-ins hides off the "all" view (no country attribution). */}
          <div className={cn("grid gap-2", matrixCols)}>
            {showOptInCol && (
              <KpiCard
                label={t("targets.kpi.opt_ins", locale)}
                value={optIns} formatted={String(optIns)}
                target={prOptIns}
                targetFormatted={prOptIns != null ? t("targets.kpi.target_of", locale, { value: String(optIns), target: String(prOptIns) }) : undefined}
                variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
              />
            )}
            <KpiCard
              label="Booked Calls" value={booked} formatted={String(booked)}
              target={prCalls}
              targetFormatted={prCalls != null ? t("targets.kpi.target_of", locale, { value: String(booked), target: String(prCalls) }) : undefined}
              notices={bookedNotices}
              variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
            {!isMarketing && (
              <KpiCard
                label="Taken Calls" value={taken} formatted={String(taken)}
                target={prTaken}
                targetFormatted={prTaken != null ? t("targets.kpi.target_of", locale, { value: String(taken), target: String(prTaken) }) : undefined}
                notice={notUpdated > 0 ? t("targets.kpi.not_updated", locale, { n: String(notUpdated) }) : undefined}
                noticeTitle={notUpdated > 0 ? t("targets.kpi.not_updated_title", locale, { n: String(notUpdated) }) : undefined}
                notices={noShows + cancellations > 0 ? [{
                  label: `${noShows + cancellations} no-show / cancel`,
                  tone: "danger",
                  title: `${noShows} no-show + ${cancellations} cancellation${cancellations === 1 ? "" : "s"} - booked calls that dropped off before a taken call. Booked = Taken + Not-updated + these + Upcoming.`,
                }] : undefined}
                variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
              />
            )}
            <KpiCard
              label="Deals" value={deals} formatted={String(deals)}
              target={prDeals}
              targetFormatted={prDeals != null ? t("targets.kpi.target_of", locale, { value: String(deals), target: String(prDeals) }) : undefined}
              variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
          </div>

          {/* Row 2 (costs), view-aware and mirroring Row 1:
              Marketing → Cost/opt-in · CBC (spend ÷ leads) · CPD
              Sales     → CBC (spend ÷ appointments) · CTC (spend ÷ taken) · CPD
              CBC has no valid Settings target under the Marketing (leads) basis,
              so it shows untargeted there. `-` via fmtCost() when spend is missing. */}
          <div className={cn("grid gap-2", matrixCols)}>
            {showOptInCol && (
              <KpiCard
                label={t("targets.kpi.cost_per_opt_in", locale)}
                value={hasMetaSpend ? cpOptIn : null}
                formatted={fmtCost(formatCurrencyDecimal(cpOptIn))}
                target={hasMetaSpend ? tgt?.cpOptIn || undefined : undefined}
                targetFormatted={hasMetaSpend && tgt?.cpOptIn ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(cpOptIn), target: formatCurrencyDecimal(tgt.cpOptIn) }) : undefined}
                variant="cost" isLoading={loading} isMtdPlaceholder={mondayMtdPlaceholder}
              />
            )}
            <KpiCard
              label="CBC" value={hasMetaSpend ? safeDivide(spend, booked) : null}
              formatted={fmtCost(formatCurrencyDecimal(safeDivide(spend, booked)))}
              target={hasMetaSpend ? tgt?.cbc || undefined : undefined}
              targetFormatted={hasMetaSpend && tgt?.cbc ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(safeDivide(spend, booked)), target: formatCurrencyDecimal(tgt.cbc) }) : undefined}
              variant="cost" isLoading={loading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
            {!isMarketing && (
              <KpiCard
                label="CTC" value={hasMetaSpend ? safeDivide(spend, taken) : null}
                formatted={fmtCost(formatCurrencyDecimal(safeDivide(spend, taken)))}
                target={hasMetaSpend ? tgt?.ctc || undefined : undefined}
                targetFormatted={hasMetaSpend && tgt?.ctc ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(safeDivide(spend, taken)), target: formatCurrencyDecimal(tgt.ctc) }) : undefined}
                variant="cost" isLoading={loading} isMtdPlaceholder={mondayMtdPlaceholder}
              />
            )}
            <KpiCard
              label="CPD" value={hasMetaSpend ? safeDivide(spend, deals) : null}
              formatted={fmtCost(formatCurrencyDecimal(safeDivide(spend, deals)))}
              target={hasMetaSpend ? tgt?.cpd || undefined : undefined}
              targetFormatted={hasMetaSpend && tgt?.cpd ? t("targets.kpi.target_of", locale, { value: formatCurrencyDecimal(safeDivide(spend, deals)), target: formatCurrencyDecimal(tgt.cpd) }) : undefined}
              variant="cost" isLoading={loading} isMtdPlaceholder={mondayMtdPlaceholder}
            />
          </div>

          {/* Surface a one-line warning when Meta data is missing so the CM
              knows the `-` cost cells aren't "all good zeros" but a real fetch
              issue worth investigating (probably a Meta token / API hiccup -
              the cron now refuses to cache empty results so a retry usually
              fixes it). Errors flow through this banner too. */}
          {!data.metaLoading && !hasMetaSpend && (
            <div className="text-[11px] text-amber-600 px-1 inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              {data.metaError
                ? `Ad spend data not loaded: ${data.metaError}`
                : "Ad spend = 0 for this period. Cost-per metrics aren't reliable until spend data refreshes."}
            </div>
          )}
        </div>

        {ratiosGroup && (
          <div className="pt-1">
            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">{ratiosGroup.title}</h3>
            {/* Row 3 (ratios), view-aware:
                Marketing → Booking Rate (Booked ÷ Opt-ins) · Conversion (Deals ÷
                            Booked) · ROAS. Booking rate needs opt-ins, so it hides
                            under a country filter (2-col, matching metrics/costs).
                Sales     → Show-up (Taken ÷ Booked) · Conversion (Deals ÷ Taken) ·
                            ROAS - the shared ratio calcs, unchanged.
                Ratios mix Monday volume with Meta spend; when Monday serves MTD as
                a placeholder the ratio is partially wrong - flag it via MTD pill. */}
            <div className={cn("grid gap-2", matrixCols)}>
              {isMarketing ? (
                <>
                  {showOptInCol && (
                    <KpiCard
                      label={t("targets.kpi.appointment_booking_rate", locale)}
                      value={bookingRate}
                      formatted={`${bookingRate.toFixed(1)}%`}
                      target={bookingRateTarget}
                      targetFormatted={bookingRateTarget != null ? t("targets.kpi.target_of", locale, { value: `${bookingRate.toFixed(1)}%`, target: `${bookingRateTarget.toFixed(0)}%` }) : undefined}
                      variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
                    />
                  )}
                  <KpiCard
                    label="Conversion Rate"
                    value={mktConvRate}
                    formatted={`${mktConvRate.toFixed(1)}%`}
                    target={convRateTarget}
                    targetFormatted={convRateTarget != null ? t("targets.kpi.target_of", locale, { value: `${mktConvRate.toFixed(1)}%`, target: `${convRateTarget.toFixed(0)}%` }) : undefined}
                    variant="volume" isLoading={data.mondayLoading} isMtdPlaceholder={mondayMtdPlaceholder}
                  />
                  {roasKpi && <KpiCard {...roasKpi} isMtdPlaceholder={mondayMtdPlaceholder} />}
                </>
              ) : (
                ratiosGroup.kpis.map((kpi) => (
                  <KpiCard key={kpi.label} {...kpi} isMtdPlaceholder={mondayMtdPlaceholder} />
                ))
              )}
            </div>
          </div>
        )}

        {/* Full Booked reconciliation - every booked call lands in exactly one
            bucket, so the row visibly adds up to Booked. This is what tells the CM
            where the funnel goes: Taken (call happened) + no-shows + cancellations
            + not-updated (past, closer hasn't recorded an outcome) + upcoming
            (future). Not-updated is amber - it's the data-quality gap that drags
            the taken/show-up numbers down until the closer fills it in.
            Sales-only: it reconciles the appointment-date Booked, which is the
            Sales lens - in Marketing "Booked" means leads-created, a different set. */}
        {!isMarketing && calls > 0 && (
          <div className="pt-1 text-[11px] text-muted-foreground px-1">
            <span className="font-medium">Booked breakdown:</span>{" "}
            <span className="tabular-nums">{calls} booked</span>
            {" = "}
            <span className="tabular-nums">{taken} taken</span>
            {" + "}
            <span className="tabular-nums">{noShows} no-show{noShows === 1 ? "" : "s"}</span>
            {" + "}
            <span className="tabular-nums">{cancellations} cancellation{cancellations === 1 ? "" : "s"}</span>
            {" + "}
            <span
              className={cn("tabular-nums", notUpdated > 0 && "text-amber-600")}
              title="Past appointments still in Planned / Qualified / Gepland - the closer hasn't recorded an outcome. Not counted as taken."
            >
              {notUpdated} not updated
            </span>
            {" + "}
            <span className="tabular-nums" title="Future appointments booked in this period - haven't happened yet.">
              {upcoming} upcoming
            </span>
          </div>
        )}
      </section>

      {/* ── SECTION 3 - BREAKDOWN ── */}
      <section className="space-y-3">
        <SectionHeader title={t("targets.section.breakdown.title", locale)} />

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
        mondayRevenue={m?.closedRevenue ?? 0}
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

  // Default view = unmatched only - that's the actual gap. Server-side fuzzy pairing
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
      <div className="absolute inset-0 bg-foreground/25 supports-backdrop-filter:backdrop-blur-sm" onClick={onClose} />
      <div
        className="bg-popover ring-1 ring-foreground/10 rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
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
                      <th className="text-left py-2 px-4 font-mono text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground/70">{t("targets.stripe.col.date", locale)}</th>
                      <th className="text-left py-2 px-4 font-mono text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground/70">{t("targets.stripe.col.lead_company_closer", locale)}</th>
                      <th className="text-right py-2 px-4 font-mono text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground/70">{t("targets.stripe.col.value", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDeals.map((d) => (
                      <tr key={d.mondayItemId} className={cn("border-b border-border/20 last:border-0 hover:bg-muted/30", d.matched && "opacity-60")}>
                        <td className="py-2 px-4 font-mono text-muted-foreground">{d.dateDeal || "-"}</td>
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
                      <th className="text-left py-2 px-4 font-mono text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground/70">{t("targets.stripe.col.date", locale)}</th>
                      <th className="text-left py-2 px-4 font-mono text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground/70">{t("targets.stripe.col.customer_invoice", locale)}</th>
                      <th className="text-right py-2 px-4 font-mono text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground/70">{t("targets.stripe.col.amount", locale)}</th>
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
      <div className="section-title">
        {title}
        {subtitle && <span className="count hidden sm:inline">{subtitle}</span>}
      </div>
    </div>
  )
}
