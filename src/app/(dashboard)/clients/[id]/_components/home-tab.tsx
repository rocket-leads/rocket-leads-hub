"use client"

import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { differenceInCalendarDays, format, isSameDay, startOfMonth, subDays, subMonths } from "date-fns"
import {
  Euro,
  Users,
  Activity,
  TrendingUp,
  TrendingDown,
  Trophy,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiTile } from "@/components/ui/kpi-tile"
import { DateRangePicker } from "@/app/(dashboard)/targets/_components/date-range-picker"
import { useClientDateRange } from "@/app/(dashboard)/clients/[id]/_hooks/use-client-date-range"
import { categorizeHealthVsBaseline, type WatchCategory } from "@/lib/watchlist/categorize"
import { PedroInsightCard } from "./pedro-insight-card"
import { OnboardingChecklist } from "./onboarding-checklist"
import { TrendChart } from "./trend-chart"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import type { KpiResult } from "@/lib/clients/kpis"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { MondayClient } from "@/lib/integrations/monday"
import type { WatchlistExpandResponse } from "@/app/api/watchlist/[id]/expand/route"

type Props = {
  client: MondayClient
  canViewCampaigns: boolean
  /** Bumped by the page-level Refresh button. When > 0, kpisQuery includes
   *  it in the queryKey (forces a refetch) and passes `?forceRefresh=1` so
   *  the API bypasses its server-side `cache_store` entries for Monday +
   *  Meta. Without this, Refresh appears to do nothing because the 10-min
   *  cache keeps serving stale numbers. */
  refreshNonce: number
  onNavigateToCampaigns: () => void
}

/** Health tone classes (color) + dictionary label key per category. Label is
 *  resolved through t() so the language switch flips "Action ↔ Actie" without
 *  the visual treatment having to change. */
const HEALTH_TONES: Record<WatchCategory, { bg: string; border: string; text: string; dot: string; labelKey: DictionaryKey }> = {
  action: {
    bg: "bg-red-500/10",
    border: "border-red-500/40",
    text: "text-red-500 dark:text-red-400",
    dot: "bg-red-500",
    labelKey: "client.home.health.action",
  },
  watch: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    labelKey: "client.home.health.watch",
  },
  good: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    labelKey: "client.home.health.good",
  },
  "no-data": {
    bg: "bg-muted/30",
    border: "border-border/60",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground/40",
    labelKey: "client.home.health.no_data",
  },
}

function fmtCurrency(n: number): string {
  if (!isFinite(n) || n === 0) return "-"
  return `€${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtInt(n: number): string {
  if (!isFinite(n) || n === 0) return "-"
  return n.toLocaleString("en-GB")
}

/**
 * Compact label for a date window. Recognises the common presets exposed by
 * `useDateRange` ("Last 7 Days" → "7d", "MTD" → "MTD", "Last Month" → "Last
 * Month") and falls back to a literal day count for anything bespoke. Used to
 * suffix the Home tab's KPI cards + thread the same label through the Health
 * card insight so both sides of the comparison are unambiguous.
 */
function describeWindow(start: Date, end: Date): string {
  const today = new Date()
  const yesterday = subDays(today, 1)
  const days = differenceInCalendarDays(end, start) + 1

  // End must be yesterday for any of the rolling-window presets to apply -
  // otherwise we're looking at a historical range and the day count is the
  // only honest label.
  if (isSameDay(end, yesterday)) {
    if (days === 7) return "7d"
    if (days === 14) return "14d"
    if (days === 30) return "30d"
    if (days >= 89 && days <= 92) return "Last 3M"
    if (isSameDay(start, startOfMonth(today))) return "MTD"
  }

  // "Last Month" - start at first day of last month, end at last day of last month.
  const lastMonth = subMonths(today, 1)
  const lastMonthStart = startOfMonth(lastMonth)
  // endOfMonth would need an import; cheap to compute: day before this month starts.
  const lastMonthEnd = subDays(startOfMonth(today), 1)
  if (isSameDay(start, lastMonthStart) && isSameDay(end, lastMonthEnd)) return "Last Month"

  // Fallback: literal day count, then a date range for long bespoke windows.
  if (days <= 365) return `${days}d`
  return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`
}

function KpiCard({
  label,
  icon: Icon,
  value,
  windowLabel,
  loading,
}: {
  label: string
  icon: typeof Euro
  value: string
  /** Tiny period suffix shown next to the label, e.g. "7d" or "MTD". Required
   *  on the Home tab so the user can never confuse this card with the Health
   *  card next to it which reads a different (fixed 30d baseline) window. */
  windowLabel?: string
  loading?: boolean
}) {
  return (
    <KpiTile
      label={label}
      icon={<Icon />}
      windowLabel={windowLabel}
      value={value}
      loading={loading}
    />
  )
}

function HealthCard({
  category,
  insight,
  loading,
  locale,
}: {
  category: WatchCategory
  insight: string
  loading?: boolean
  locale: Locale
}) {
  const tone = HEALTH_TONES[category]

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-3 w-32" />
      </div>
    )
  }

  // Same chrome shell as KpiCard so the four-up grid lines up cleanly; the
  // tone classes layer color on top of the shared border + radius.
  return (
    <div className={`rounded-2xl px-5 py-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] border ${tone.bg} ${tone.border}`}>
      <div className="flex items-center gap-2 mb-3">
        <Activity className={`h-3.5 w-3.5 ${tone.text}`} />
        <span className={`text-[11px] uppercase tracking-wider font-medium ${tone.text}`}>{t("client.home.health.label", locale)}</span>
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
        <p className={`font-heading text-[22px] font-bold tracking-tight leading-none ${tone.text}`}>{t(tone.labelKey, locale)}</p>
      </div>
      <p className={`text-[11px] leading-snug ${tone.text} opacity-80`}>{insight}</p>
    </div>
  )
}

function TopAdsCard({
  ads,
  loading,
  locale,
}: {
  ads: WatchlistExpandResponse["topAds"] | undefined
  loading: boolean
  locale: Locale
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-32" />
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">
              {t("client.home.top_ads.title", locale)}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground/40">{t("client.home.top_ads.subtitle", locale)}</span>
        </div>

        {!ads || ads.length === 0 ? (
          <p className="text-[12px] text-muted-foreground/60 italic py-2">
            {t("client.home.top_ads.empty", locale)}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {ads.map((ad, i) => {
              const cplLabel = ad.leads > 0 && ad.cpl > 0 ? `€${ad.cpl.toFixed(2)}` : "-"
              const cplColor =
                ad.verdict === "winner"
                  ? "text-emerald-500"
                  : ad.verdict === "loser"
                    ? "text-red-500"
                    : "text-muted-foreground"
              return (
                <li key={`${ad.adName}-${i}`} className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="text-foreground/85 truncate flex-1 min-w-0" title={ad.adName}>
                    {ad.adName}
                  </span>
                  <span className="text-muted-foreground/60 tabular-nums shrink-0">
                    €{ad.spend.toFixed(0)} · {ad.leads}L
                  </span>
                  <span className={`tabular-nums font-medium shrink-0 ${cplColor}`}>{cplLabel}</span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
export function HomeTab({
  client,
  canViewCampaigns,
  refreshNonce,
  onNavigateToCampaigns: _onNavigateToCampaigns,
}: Props) {
  const locale = useLocale()
  const queryClient = useQueryClient()
  // useClientDateRange (slide-over only) defaults to Last 7 Days every
  // open, no localStorage persistence - so the picker on /clients
  // overview or /targets can't leak in and make the KPI cards under a
  // Watch List link disagree with the canonical 7d numbers.
  const { range, setRange, presets, applyPreset, formatDate } = useClientDateRange()
  const startDateStr = formatDate(range.startDate)
  const endDateStr = formatDate(range.endDate)
  const maxPickerDate = useMemo(() => subDays(new Date(), 1), [])

  // Friendly label for the currently-selected window. Drives the suffix on
  // the KPI cards (`Ad Spend · 7d`) and the "current" leg of the Health card
  // insight string. Common ranges are recognised and named ("7d", "MTD",
  // "Last Month"); anything bespoke falls back to a literal day count.
  const currentWindowLabel = useMemo(
    () => describeWindow(range.startDate, range.endDate),
    [range.startDate, range.endDate],
  )

  // 30d baseline window - yesterday back 30 days. The Health card always
  // compares the user-selected current window against this. Kept stable so
  // changing the picker only shifts the "current" side of the comparison;
  // the baseline stays anchored.
  const { baselineStart, baselineEnd, baselineLabel } = useMemo(() => {
    const end = subDays(new Date(), 1)
    const start = subDays(end, 29)
    return {
      baselineStart: format(start, "yyyy-MM-dd"),
      baselineEnd: format(end, "yyyy-MM-dd"),
      baselineLabel: "30d",
    }
  }, [])
  // 90d long-baseline - cross-check against the 30d baseline so we can spot
  // "baseline drifted high" (Roy 2026-05): if the client was off-track for
  // weeks, the 30d itself is degraded and a "good vs 30d" verdict is
  // misleading recovery-from-bad rather than genuine recovery.
  const { longBaselineStart, longBaselineEnd, longBaselineLabel } = useMemo(() => {
    const end = subDays(new Date(), 1)
    const start = subDays(end, 89)
    return {
      longBaselineStart: format(start, "yyyy-MM-dd"),
      longBaselineEnd: format(end, "yyyy-MM-dd"),
      longBaselineLabel: "90d",
    }
  }, [])
  // When the selected window is 30d+ the baseline equals (or overlaps) the
  // current - comparison would be meaningless. The categorizer renders a
  // "no baseline yet" message in that case. Drift cross-check is also
  // suppressed when the user is already looking at the long window.
  const baselineSuppressed = useMemo(
    () => differenceInCalendarDays(range.endDate, range.startDate) + 1 >= 30,
    [range.startDate, range.endDate],
  )
  const longBaselineSuppressed = useMemo(
    () => differenceInCalendarDays(range.endDate, range.startDate) + 1 >= 90,
    [range.startDate, range.endDate],
  )

  // Whether the user-selected window matches the cron's canonical last-7d.
  // Drives a single-source-of-truth decision: when this is true, the KPI
  // cards + Health current value read from `kpi_summaries` (same bucket the
  // Watch List + Home page + Pedro narrative read), so they can never
  // disagree. When the user picks a custom range, we live-fetch via the
  // kpis endpoint - no Watch List equivalent for that window, so no risk
  // of cross-surface mismatch.
  const isCronSevenDayWindow = useMemo(() => {
    const end = subDays(new Date(), 1)
    const start = subDays(end, 6)
    return formatDate(start) === startDateStr && formatDate(end) === endDateStr
  }, [startDateStr, endDateStr, formatDate])

  // Period KPIs (AdSpend, Leads, CPL) - driven by the period selector.
  // Disabled when the selected window is the canonical 7d; that case reads
  // from kpi_summaries via `summaryQuery` below so every surface shows the
  // same number. `refreshNonce` is part of the queryKey so the Refresh
  // button reliably triggers a refetch on the custom-range path, and we
  // forward `forceRefresh=1` so the API bypasses its server-side cache.
  const kpisQuery = useQuery<KpiResult>({
    queryKey: ["kpis", client.mondayItemId, startDateStr, endDateStr, refreshNonce],
    queryFn: () => {
      const p = new URLSearchParams({
        startDate: startDateStr,
        endDate: endDateStr,
        ...(client.metaAdAccountId ? { adAccountId: client.metaAdAccountId } : {}),
        ...(client.clientBoardId ? { clientBoardId: client.clientBoardId } : {}),
        ...(refreshNonce > 0 ? { forceRefresh: "1" } : {}),
      })
      return fetch(`/api/clients/${client.mondayItemId}/kpis?${p}`).then((r) => r.json())
    },
    enabled:
      !isCronSevenDayWindow &&
      canViewCampaigns &&
      (!!client.metaAdAccountId || !!client.clientBoardId),
  })

  // 30d baseline KPI - Health card compares the selected window against this.
  // Same `/kpis` endpoint as kpisQuery but fixed to the 30d window so the
  // baseline doesn't move when the user shifts the period picker. Skipped
  // when selected window already overlaps baseline (suppressComparison path).
  const kpisBaselineQuery = useQuery<KpiResult>({
    queryKey: ["kpis-baseline-30d", client.mondayItemId, baselineStart, baselineEnd, refreshNonce],
    queryFn: () => {
      const p = new URLSearchParams({
        startDate: baselineStart,
        endDate: baselineEnd,
        ...(client.metaAdAccountId ? { adAccountId: client.metaAdAccountId } : {}),
        ...(client.clientBoardId ? { clientBoardId: client.clientBoardId } : {}),
        ...(refreshNonce > 0 ? { forceRefresh: "1" } : {}),
      })
      return fetch(`/api/clients/${client.mondayItemId}/kpis?${p}`).then((r) => r.json())
    },
    enabled:
      !baselineSuppressed &&
      canViewCampaigns &&
      (!!client.metaAdAccountId || !!client.clientBoardId),
  })

  // 90d long-baseline - only used for the baseline-drift cross-check.
  // Same endpoint, longer window. Skipped when selected window already
  // overlaps the 90d (user is looking at the long lens themselves).
  const kpisLongBaselineQuery = useQuery<KpiResult>({
    queryKey: ["kpis-baseline-90d", client.mondayItemId, longBaselineStart, longBaselineEnd, refreshNonce],
    queryFn: () => {
      const p = new URLSearchParams({
        startDate: longBaselineStart,
        endDate: longBaselineEnd,
        ...(client.metaAdAccountId ? { adAccountId: client.metaAdAccountId } : {}),
        ...(client.clientBoardId ? { clientBoardId: client.clientBoardId } : {}),
        ...(refreshNonce > 0 ? { forceRefresh: "1" } : {}),
      })
      return fetch(`/api/clients/${client.mondayItemId}/kpis?${p}`).then((r) => r.json())
    },
    enabled:
      !longBaselineSuppressed &&
      canViewCampaigns &&
      (!!client.metaAdAccountId || !!client.clientBoardId),
  })

  // 7d summary - single source of truth for the KPI cards + Health card
  // current value when the user is on the canonical 7d window. Reads the
  // same kpi_summaries cache that the Watch List + Home page + Pedro
  // narrative all read from, so all four surfaces show identical numbers.
  // Refresh button bumps refreshNonce → ?force=1 → endpoint bypasses the
  // per-client fast-path cache and live-recomputes this client, writing
  // the fresh value back so subsequent reads (and the rest of the app) see
  // it within a single cron tick rather than waiting up to an hour.
  const summaryQuery = useQuery<Record<string, KpiSummary>>({
    queryKey: ["kpi-summary-single", client.mondayItemId, refreshNonce],
    queryFn: () => {
      const url = refreshNonce > 0
        ? "/api/kpi-summaries?force=1"
        : "/api/kpi-summaries"
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clients: [
            {
              mondayItemId: client.mondayItemId,
              metaAdAccountId: client.metaAdAccountId || null,
              clientBoardId: client.clientBoardId || null,
            },
          ],
        }),
      }).then((r) => r.json())
    },
    enabled: canViewCampaigns && (!!client.metaAdAccountId || !!client.clientBoardId),
    staleTime: 5 * 60 * 1000,
    placeholderData: () => {
      const matches = queryClient.getQueriesData<Record<string, KpiSummary>>({
        queryKey: ["kpi-summaries"],
      })
      for (const [, data] of matches) {
        const entry = data?.[client.mondayItemId]
        if (entry) return { [client.mondayItemId]: entry }
      }
      return undefined
    },
  })

  const kpiSummary = summaryQuery.data?.[client.mondayItemId]
  // Single-source-of-truth resolver for the "current" leg of the Health
  // verdict + KPI cards. When the user is on the canonical 7d window we
  // read from kpiSummary (kpi_summaries cache), exactly what the Watch
  // List + Home page + Pedro narrative read. When the user picks a custom
  // range, fall back to the live kpisQuery - no Watch List equivalent
  // exists for that range so there's nothing to drift against.
  const currentCpl = isCronSevenDayWindow
    ? kpiSummary?.cpl ?? 0
    : kpisQuery.data?.costPerLead ?? 0
  const currentLeads = isCronSevenDayWindow
    ? kpiSummary?.leads ?? 0
    : kpisQuery.data?.leads ?? 0
  const currentSpend = isCronSevenDayWindow
    ? kpiSummary?.adSpend ?? 0
    : kpisQuery.data?.adSpend ?? 0
  // Whether the displayed leads number is the Meta-reported count substituted
  // because Monday returned 0 (no board linked / fetch failed / wrong mapping).
  // Read from whichever source is active so the silent fallback - which makes a
  // broken Monday link look like a plausible-but-wrong number - is never hidden.
  const isMetaFallback = isCronSevenDayWindow
    ? kpiSummary?.metaFallback ?? false
    : kpisQuery.data?.metaFallback ?? false
  const mondayCrmConnected = isCronSevenDayWindow
    ? kpiSummary?.mondayCrmConnected ?? false
    : kpisQuery.data?.mondayCrmConnected ?? false
  const health = useMemo(() => {
    const baseline = kpisBaselineQuery.data
    const longBaseline = kpisLongBaselineQuery.data
    return categorizeHealthVsBaseline({
      currentCpl,
      currentLeads,
      currentSpend,
      currentWindowLabel,
      baselineCpl: baseline?.costPerLead ?? 0,
      baselineLeads: baseline?.leads ?? 0,
      baselineSpend: baseline?.adSpend ?? 0,
      baselineWindowLabel: baselineLabel,
      ...(longBaselineSuppressed
        ? {}
        : {
            longBaselineCpl: longBaseline?.costPerLead ?? 0,
            longBaselineLeads: longBaseline?.leads ?? 0,
            longBaselineSpend: longBaseline?.adSpend ?? 0,
            longBaselineWindowLabel: longBaselineLabel,
          }),
      suppressComparison: baselineSuppressed,
      locale,
    })
  }, [
    currentCpl,
    currentLeads,
    currentSpend,
    kpisBaselineQuery.data,
    kpisLongBaselineQuery.data,
    currentWindowLabel,
    baselineLabel,
    longBaselineLabel,
    baselineSuppressed,
    longBaselineSuppressed,
    locale,
  ])

  // Top ads (30d) - surfaced under the Pedro card so the user can verify which
  // specific ads are driving Pedro's verdict. The AI activity summary that used
  // to live alongside this has been absorbed into the unified Pedro insight,
  // and the 14d daily-trend sparkline that used to live in the Watch List rows
  // is no longer rendered either. So we ask the expand endpoint for `topAds`
  // only - skips a Meta-daily fetch (~1s), a Monday updates fetch (~500ms),
  // and a Claude AI generation (~1-3s on a cache miss), dropping latency from
  // ~6s to ~1-2s.
  const expandQuery = useQuery<WatchlistExpandResponse>({
    queryKey: ["client-expand", client.mondayItemId],
    queryFn: () =>
      fetch(`/api/watchlist/${client.mondayItemId}/expand?fields=topAds`).then((r) => r.json()),
    enabled: canViewCampaigns && !!client.metaAdAccountId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Display values for the KPI cards are derived once above (single source
  // of truth: `currentSpend / currentLeads / currentCpl` - kpi_summaries
  // for the canonical 7d window, live kpisQuery for custom ranges).
  const adSpendValue = currentSpend
  const leadsValue = currentLeads
  const cplValue = currentCpl
  const kpisLoading = isCronSevenDayWindow
    ? summaryQuery.isLoading && !kpiSummary
    : kpisQuery.isLoading

  return (
    <div className="space-y-5">
      <OnboardingChecklist client={client} />

      {/* Pedro now sits ABOVE the KPI cards - short conclusion-only
          headline so the page opens with the read, not the raw numbers.
          Action bullets removed; the weekly client update below already
          carries the same content. */}
      <PedroInsightCard mondayItemId={client.mondayItemId} locale={locale} />

      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePicker
          startDate={range.startDate}
          endDate={range.endDate}
          onChange={setRange}
          maxDate={maxPickerDate}
        />
        <div className="flex gap-1 flex-wrap">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset)}
              className="h-8 px-2.5 text-[11px] rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {isMetaFallback && !kpisLoading && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          <Activity className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {t("client.home.meta_fallback.prefix", locale)}{" "}
            {mondayCrmConnected
              ? t("client.home.meta_fallback.monday_zero", locale)
              : t("client.home.meta_fallback.monday_unlinked", locale)}{" "}
            {t("client.home.meta_fallback.suffix", locale)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Ad Spend" icon={Euro} value={fmtCurrency(adSpendValue)} windowLabel={currentWindowLabel} loading={kpisLoading} />
        <KpiCard label="Leads" icon={Users} value={fmtInt(leadsValue)} windowLabel={currentWindowLabel} loading={kpisLoading} />
        <KpiCard
          label="CPL"
          icon={cplValue > 0 ? TrendingDown : TrendingUp}
          value={fmtCurrency(cplValue)}
          windowLabel={currentWindowLabel}
          loading={kpisLoading}
        />
        <HealthCard
          category={health.category}
          insight={health.insight}
          loading={
            kpisQuery.isLoading ||
            (!baselineSuppressed && kpisBaselineQuery.isLoading) ||
            (!longBaselineSuppressed && kpisLongBaselineQuery.isLoading)
          }
          locale={locale}
        />
      </div>

      {/* CPL + Ad Spend line chart - answers "did CPL move because spend
          changed, or independently?". Own 14d/30d/90d toggle (default
          30d) independent of the KPI cards' date range picker. */}
      {client.metaAdAccountId && (
        <TrendChart mondayItemId={client.mondayItemId} />
      )}

      {canViewCampaigns && client.metaAdAccountId && (
        <TopAdsCard ads={expandQuery.data?.topAds} loading={expandQuery.isLoading} locale={locale} />
      )}
    </div>
  )
}
