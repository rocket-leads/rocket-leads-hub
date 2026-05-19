"use client"

import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { differenceInCalendarDays, format, isSameDay, startOfMonth, subDays, subMonths } from "date-fns"
import {
  Euro,
  Users,
  CreditCard,
  Activity,
  ChevronRight,
  ListTodo,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  Trophy,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DateRangePicker } from "@/app/(dashboard)/targets/_components/date-range-picker"
import { useDateRange } from "@/app/(dashboard)/targets/_hooks/use-date-range"
import { categorizeHealthVsBaseline, type WatchCategory } from "@/lib/watchlist/categorize"
import { PedroInsightCard } from "./pedro-insight-card"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import type { KpiResult } from "@/lib/clients/kpis"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { MondayClient } from "@/lib/integrations/monday"
import type { BillingData, InvoiceRow } from "@/lib/integrations/stripe"
import type { InboxItem } from "@/types/inbox"
import type { WatchlistExpandResponse } from "@/app/api/watchlist/[id]/expand/route"

type Props = {
  client: MondayClient
  supabaseClientId: string
  canViewBilling: boolean
  canViewCampaigns: boolean
  /** Bumped by the page-level Refresh button. When > 0, kpisQuery includes
   *  it in the queryKey (forces a refetch) and passes `?forceRefresh=1` so
   *  the API bypasses its server-side `cache_store` entries for Monday +
   *  Meta. Without this, Refresh appears to do nothing because the 10-min
   *  cache keeps serving stale numbers. */
  refreshNonce: number
  onNavigateToCampaigns: () => void
  onNavigateToInbox: () => void
  onNavigateToBilling: () => void
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
  if (!isFinite(n) || n === 0) return "—"
  return `€${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtInt(n: number): string {
  if (!isFinite(n) || n === 0) return "—"
  return n.toLocaleString("en-GB")
}

function fmtCurrencyShort(n: number): string {
  return `€${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
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

  // End must be yesterday for any of the rolling-window presets to apply —
  // otherwise we're looking at a historical range and the day count is the
  // only honest label.
  if (isSameDay(end, yesterday)) {
    if (days === 7) return "7d"
    if (days === 14) return "14d"
    if (days === 30) return "30d"
    if (days >= 89 && days <= 92) return "Last 3M"
    if (isSameDay(start, startOfMonth(today))) return "MTD"
  }

  // "Last Month" — start at first day of last month, end at last day of last month.
  const lastMonth = subMonths(today, 1)
  const lastMonthStart = startOfMonth(lastMonth)
  // endOfMonth would need an import; cheap to compute: day before this month starts.
  const lastMonthEnd = subDays(startOfMonth(today), 1)
  if (isSameDay(start, lastMonthStart) && isSameDay(end, lastMonthEnd)) return "Last Month"

  // Fallback: literal day count, then a date range for long bespoke windows.
  if (days <= 365) return `${days}d`
  return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`
}

function summarizePayments(invoices: InvoiceRow[] | undefined) {
  if (!invoices) return null
  const overdue = invoices.filter((i) => i.status === "overdue")
  const open = invoices.filter((i) => i.status === "open")
  if (overdue.length > 0) {
    return {
      kind: "overdue" as const,
      count: overdue.length,
      amount: overdue.reduce((s, i) => s + (i.amountDue - i.amountPaid), 0),
    }
  }
  if (open.length > 0) {
    return {
      kind: "open" as const,
      count: open.length,
      amount: open.reduce((s, i) => s + (i.amountDue - i.amountPaid), 0),
    }
  }
  return { kind: "complete" as const }
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
  // Chrome aligned to the KpiTile primitive: rounded-2xl border-border/60 +
  // px-5 py-4 + 11px uppercase label + 26px hero number with tabular-nums.
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">
          {label}
          {windowLabel && (
            <span className="text-muted-foreground/40 font-normal"> · {windowLabel}</span>
          )}
        </span>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <p className="font-heading text-[26px] font-bold tracking-tight tabular-nums leading-none">{value}</p>
      )}
    </div>
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
              const cplLabel = ad.leads > 0 && ad.cpl > 0 ? `€${ad.cpl.toFixed(2)}` : "—"
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

function PaymentBanner({
  summary,
  loading,
  onClick,
  locale,
}: {
  summary: ReturnType<typeof summarizePayments> | null
  loading: boolean
  onClick: () => void
  locale: Locale
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-5 w-40" />
        </CardContent>
      </Card>
    )
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground/60">{t("client.home.payment.no_stripe", locale)}</CardContent>
      </Card>
    )
  }

  const tone = (() => {
    if (summary.kind === "complete") return { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" }
    if (summary.kind === "open") return { bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" }
    return { bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-500 dark:text-red-400", dot: "bg-red-500" }
  })()

  const label = (() => {
    if (summary.kind === "complete") return t("client.home.payment.paid", locale)
    const amount = fmtCurrencyShort(summary.amount)
    const count = String(summary.count)
    if (summary.kind === "open") {
      return t(summary.count === 1 ? "client.home.payment.open_one" : "client.home.payment.open_many", locale, { count, amount })
    }
    return t(summary.count === 1 ? "client.home.payment.overdue_one" : "client.home.payment.overdue_many", locale, { count, amount })
  })()

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left ${tone.bg} ${tone.border} border rounded-xl px-4 py-3.5 hover:brightness-110 hover:shadow-sm transition-all duration-150 cursor-pointer group`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 rounded-lg ${tone.bg} flex items-center justify-center`}>
            <CreditCard className={`h-4 w-4 ${tone.text}`} />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-0.5">{t("client.home.payment.label", locale)}</p>
            <p className={`text-sm font-semibold ${tone.text}`}>{label}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 text-[11px] ${tone.text} opacity-60 group-hover:opacity-100 transition-opacity shrink-0`}>
          {t("client.home.payment.open_billing", locale)}
          <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </button>
  )
}

function relativeDue(due: string | null, locale: Locale): { label: string; tone: string } {
  if (!due) return { label: t("client.home.due.none", locale), tone: "text-muted-foreground/60" }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(due); target.setHours(0, 0, 0, 0)
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { label: t("client.home.due.overdue", locale, { n: String(Math.abs(diffDays)) }), tone: "text-red-500" }
  if (diffDays === 0) return { label: t("client.home.due.today", locale), tone: "text-amber-500" }
  if (diffDays === 1) return { label: t("client.home.due.tomorrow", locale), tone: "text-amber-500" }
  if (diffDays <= 7) return { label: t("client.home.due.in_days", locale, { n: String(diffDays) }), tone: "text-foreground/70" }
  return { label: t("client.home.due.on_date", locale, { date: due }), tone: "text-muted-foreground/60" }
}

function TasksList({
  tasks,
  loading,
  onSeeAll,
  locale,
}: {
  tasks: InboxItem[]
  loading: boolean
  onSeeAll: () => void
  locale: Locale
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-32" />
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  // Whole card is one big click target — keeps the hover/click semantics
  // consistent with the Lead Analysis and Payment cards above. Individual
  // tasks aren't separately clickable; they all route to the same place
  // anyway, so adding nested buttons just adds noise.
  return (
    <button
      type="button"
      onClick={onSeeAll}
      className="block w-full text-left rounded-xl border border-border/60 bg-card hover:bg-muted/40 hover:border-border hover:shadow-sm transition-all duration-150 cursor-pointer group p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListTodo className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">
            {t("client.home.tasks.title", locale)}
          </span>
          {tasks.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/70">
              {tasks.length}
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
          {t("client.home.tasks.open_inbox", locale)}
          <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 py-4 text-center">{t("client.home.tasks.empty", locale)}</p>
      ) : (
        <div className="space-y-1.5">
          {tasks.slice(0, 5).map((task) => {
            const due = relativeDue(task.dueDate, locale)
            return (
              <div
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  <p className="text-[11px] text-muted-foreground/60">
                    {t("client.home.tasks.assigned_to", locale, { name: task.assigneeName ?? "" })}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1 text-[11px] shrink-0 ${due.tone}`}>
                  <CalendarClock className="h-3 w-3" />
                  {due.label}
                </span>
              </div>
            )
          })}
          {tasks.length > 5 && (
            <p className="w-full text-center text-[11px] text-muted-foreground py-1.5">
              {t("client.home.tasks.more", locale, { n: String(tasks.length - 5) })}
            </p>
          )}
        </div>
      )}
    </button>
  )
}

export function HomeTab({
  client,
  supabaseClientId,
  canViewBilling,
  canViewCampaigns,
  refreshNonce,
  onNavigateToCampaigns: _onNavigateToCampaigns,
  onNavigateToInbox,
  onNavigateToBilling,
}: Props) {
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { range, setRange, presets, applyPreset, formatDate } = useDateRange()
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

  // 30d baseline window — yesterday back 30 days. The Health card always
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
  // 90d long-baseline — cross-check against the 30d baseline so we can spot
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
  // current — comparison would be meaningless. The categorizer renders a
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

  // Period KPIs (AdSpend, Leads, CPL) — driven by the period selector.
  // `refreshNonce` is part of the queryKey so the Refresh button reliably
  // triggers a refetch, and we forward `forceRefresh=1` whenever the user
  // explicitly asked for fresh data (nonce > 0) so the API bypasses its
  // server-side cache_store entries.
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
    enabled: canViewCampaigns && (!!client.metaAdAccountId || !!client.clientBoardId),
  })

  // 30d baseline KPI — Health card compares the selected window against this.
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

  // 90d long-baseline — only used for the baseline-drift cross-check.
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

  // 7d summary kept around solely as a fast placeholder for the kpisQuery
  // KPI cards when the selected window is the cron's canonical 7d window
  // (see `kpisPlaceholder` below). Health card no longer reads from it.
  const summaryQuery = useQuery<Record<string, KpiSummary>>({
    queryKey: ["kpi-summary-single", client.mondayItemId],
    queryFn: () =>
      fetch("/api/kpi-summaries", {
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
      }).then((r) => r.json()),
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
  const health = useMemo(() => {
    const current = kpisQuery.data
    const baseline = kpisBaselineQuery.data
    const longBaseline = kpisLongBaselineQuery.data
    return categorizeHealthVsBaseline({
      currentCpl: current?.costPerLead ?? 0,
      currentLeads: current?.leads ?? 0,
      currentSpend: current?.adSpend ?? 0,
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
    kpisQuery.data,
    kpisBaselineQuery.data,
    kpisLongBaselineQuery.data,
    currentWindowLabel,
    baselineLabel,
    longBaselineLabel,
    baselineSuppressed,
    longBaselineSuppressed,
    locale,
  ])

  // Top ads (30d) — surfaced under the Pedro card so the user can verify which
  // specific ads are driving Pedro's verdict. The AI activity summary that used
  // to live alongside this has been absorbed into the unified Pedro insight,
  // and the 14d daily-trend sparkline that used to live in the Watch List rows
  // is no longer rendered either. So we ask the expand endpoint for `topAds`
  // only — skips a Meta-daily fetch (~1s), a Monday updates fetch (~500ms),
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

  const billingQuery = useQuery<Partial<BillingData>>({
    queryKey: ["billing-check", client.mondayItemId],
    queryFn: () =>
      client.stripeCustomerId
        ? fetch(`/api/clients/${client.mondayItemId}/billing?stripeCustomerId=${client.stripeCustomerId}`).then((r) => r.json())
        : Promise.resolve({}),
    enabled: !!client.stripeCustomerId && canViewBilling,
    staleTime: 5 * 60 * 1000,
  })

  const tasksQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["client-tasks", supabaseClientId],
    queryFn: () =>
      fetch(`/api/inbox?kind=task&clientId=${supabaseClientId}&statuses=open,in_progress`).then((r) => r.json()),
    enabled: !!supabaseClientId,
    staleTime: 60 * 1000,
  })

  const paymentSummary = summarizePayments(billingQuery.data?.invoices)

  // When the date range matches the cron's canonical last-7d window (yesterday
  // back 6 days), reuse the precomputed `kpi_summaries` numbers from
  // summaryQuery as a placeholder. summaryQuery typically resolves in ~50ms
  // (single Supabase read) versus kpisQuery's 100-2000ms (Monday + Meta even
  // with our pre-warm cron), so users see real numbers immediately instead of
  // a skeleton flash.
  const isCronSevenDayWindow = useMemo(() => {
    const end = subDays(new Date(), 1)
    const start = subDays(end, 6)
    return formatDate(start) === startDateStr && formatDate(end) === endDateStr
  }, [startDateStr, endDateStr, formatDate])

  const kpisPlaceholder = useMemo(() => {
    if (!isCronSevenDayWindow || !kpiSummary) return null
    return {
      adSpend: kpiSummary.adSpend,
      leads: kpiSummary.leads,
      costPerLead: kpiSummary.cpl,
    }
  }, [isCronSevenDayWindow, kpiSummary])

  const adSpendValue = kpisQuery.data?.adSpend ?? kpisPlaceholder?.adSpend ?? 0
  const leadsValue = kpisQuery.data?.leads ?? kpisPlaceholder?.leads ?? 0
  const cplValue = kpisQuery.data?.costPerLead ?? kpisPlaceholder?.costPerLead ?? 0
  const kpisLoading = kpisQuery.isLoading && !kpisPlaceholder

  return (
    <div className="space-y-5">
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

      {/* Single Pedro insight — replaces the old LeadAnalysisCard / Activity
          Summary / Optimization Proposal stack. One AI voice across the platform. */}
      <PedroInsightCard mondayItemId={client.mondayItemId} locale={locale} />

      {canViewCampaigns && client.metaAdAccountId && (
        <TopAdsCard ads={expandQuery.data?.topAds} loading={expandQuery.isLoading} locale={locale} />
      )}

      {client.stripeCustomerId && canViewBilling && (
        <PaymentBanner
          summary={paymentSummary}
          loading={billingQuery.isLoading}
          onClick={onNavigateToBilling}
          locale={locale}
        />
      )}

      <TasksList
        tasks={tasksQuery.data?.items ?? []}
        loading={tasksQuery.isLoading}
        onSeeAll={onNavigateToInbox}
        locale={locale}
      />
    </div>
  )
}
