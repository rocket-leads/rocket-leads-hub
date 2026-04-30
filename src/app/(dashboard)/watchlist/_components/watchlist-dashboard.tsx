"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RefreshCw, AlertCircle, AlertOctagon, TrendingUp, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Sparkles, CircleDashed, ArrowUp, ArrowDown, Minus, Lightbulb } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { WatchlistExpandResponse } from "@/app/api/watchlist/[id]/expand/route"
import type { WatchlistStateResponse } from "@/app/api/watchlist/state/route"
import type { WatchlistNarrativeResponse, WatchlistInsight } from "@/app/api/watchlist/narrative/route"
import type { WatchlistScoreHistoryResponse } from "@/app/api/watchlist/score-history/route"
import { categorize as sharedCategorize, severityScore as sharedSeverityScore, type WatchCategory as SharedWatchCategory } from "@/lib/watchlist/categorize"

// --- Categorization ---
//
// The actual category logic lives in `src/lib/watchlist/categorize.ts` so the cron
// (which writes the state table) and the UI agree on bucketing rules. This file just
// adds the UI-only fields (severity score, days/new flags from the state table).

type WatchCategory = SharedWatchCategory

type CategorizedClient = {
  client: MondayClient
  category: WatchCategory
  insight: string
  kpi: KpiSummary | undefined
  /** Severity score used to rank within Action/Watch — higher = more urgent */
  severity: number
  /** Days the client has been in this category — null when state is still loading or unknown */
  daysInBucket: number | null
  /** True when the client transitioned into this category today */
  isNewToday: boolean
  /** Yesterday's bucket — null if unknown / brand-new client */
  prevCategory: WatchCategory | null
}

const categorize = sharedCategorize
const severityScore = sharedSeverityScore

function fmtCurrency(v: number): string {
  if (v >= 1000) return `€${(v / 1000).toFixed(1)}k`
  return `€${v.toFixed(0)}`
}

/**
 * 14-day CPL sparkline. Lives in its own column on the Watch List so the trend
 * is scannable at a glance without competing with the cell numbers.
 *
 * - Series: spend / leads per day, with carry-forward on leadless days so the
 *   line doesn't crash to €0 when no leads come in (visually misleading).
 * - Color: red when CPL is meaningfully rising (last 7d vs prior 7d), green when
 *   falling, muted slate otherwise. Rising CPL = bad, so red = "look at me".
 */
function CplSparkline({ trend }: { trend: KpiSummary["dailyTrend"] }) {
  if (!trend || trend.length < 2) return <span className="text-muted-foreground/20 text-xs">—</span>

  const series: number[] = []
  let last = 0
  for (const d of trend) {
    if (d.leads > 0) last = d.spend / d.leads
    series.push(last)
  }
  if (series.every((v) => v === 0)) return <span className="text-muted-foreground/20 text-xs">—</span>

  const max = Math.max(...series)
  const min = Math.min(...series)
  const range = max - min || 1
  const w = 56
  const h = 18
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 2) - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  const half = Math.floor(series.length / 2)
  const prevAvg = series.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(half, 1)
  const currAvg = series.slice(half).reduce((a, b) => a + b, 0) / Math.max(series.length - half, 1)
  const ratio = prevAvg > 0 ? currAvg / prevAvg : 1
  const stroke = ratio >= 1.1 ? "rgb(248 113 113)" : ratio <= 0.9 ? "rgb(74 222 128)" : "rgb(148 163 184)"

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block align-middle" aria-hidden>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
    </svg>
  )
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

/**
 * Admin setup gaps surfaced in the No Data bucket. Meta ad account is intentionally
 * excluded — that gap is already produced by `categorize()` itself (with a richer
 * "no Meta ad account configured" reason). Monday board is excluded too because it
 * has a Meta-fallback path and therefore isn't a setup blocker.
 */
function getSetupGaps(client: MondayClient): string[] {
  const missing: string[] = []
  if (!client.stripeCustomerId) missing.push("Stripe")
  if (!client.trengoContactId) missing.push("Trengo")
  return missing
}

// --- Section config ---

const CATEGORY_CONFIG = {
  action: {
    label: "Action Needed",
    icon: AlertCircle,
    iconColor: "text-red-500",
    headerBg: "bg-red-500/5 border-red-500/20",
    rowBorder: "border-l-red-500/60",
    insightColor: "text-red-400",
  },
  watch: {
    label: "Watch List",
    icon: TrendingUp,
    iconColor: "text-amber-500",
    headerBg: "bg-amber-500/5 border-amber-500/20",
    rowBorder: "border-l-amber-500/60",
    insightColor: "text-amber-400",
  },
  good: {
    label: "Good Performance",
    icon: CheckCircle2,
    iconColor: "text-green-500",
    headerBg: "bg-green-500/5 border-green-500/20",
    rowBorder: "border-l-green-500/60",
    insightColor: "text-green-500",
  },
} as const

/**
 * Bigger 14-day CPL chart for the inline expand panel. Same data as `CplSparkline` but
 * with axis labels (min, max, first/last date) so the absolute scale is readable.
 */
function CplChart({ trend }: { trend: KpiSummary["dailyTrend"] }) {
  if (!trend || trend.length < 2) {
    return <div className="text-xs text-muted-foreground/40 italic">No 14d trend data available</div>
  }

  const series: number[] = []
  let last = 0
  for (const d of trend) {
    if (d.leads > 0) last = d.spend / d.leads
    series.push(last)
  }
  if (series.every((v) => v === 0)) {
    return <div className="text-xs text-muted-foreground/40 italic">No CPL data — no leads in the last 14d</div>
  }

  const max = Math.max(...series)
  const min = Math.min(...series)
  const range = max - min || 1
  const w = 320
  const h = 80
  const padTop = 6
  const padBottom = 6
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w
      const y = padTop + (h - padTop - padBottom) - ((v - min) / range) * (h - padTop - padBottom)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  const half = Math.floor(series.length / 2)
  const prevAvg = series.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(half, 1)
  const currAvg = series.slice(half).reduce((a, b) => a + b, 0) / Math.max(series.length - half, 1)
  const ratio = prevAvg > 0 ? currAvg / prevAvg : 1
  const stroke = ratio >= 1.1 ? "rgb(248 113 113)" : ratio <= 0.9 ? "rgb(74 222 128)" : "rgb(148 163 184)"

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[10px] text-muted-foreground/60 tabular-nums">
        <span>14-day CPL</span>
        <span>min €{min.toFixed(2)} · max €{max.toFixed(2)}</span>
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block w-full max-w-[320px]">
        <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex items-baseline justify-between text-[10px] text-muted-foreground/40 tabular-nums">
        <span>{trend[0].date}</span>
        <span>{trend[trend.length - 1].date}</span>
      </div>
    </div>
  )
}

function ExpandedRow({ client, insight }: { client: MondayClient; kpi: KpiSummary | undefined; insight: string }) {
  const { data, isLoading } = useQuery<WatchlistExpandResponse>({
    queryKey: ["watchlist-expand", client.mondayItemId, insight],
    // Pass the visible Insight text to the endpoint so the AI summary won't repeat it.
    queryFn: () =>
      fetch(`/api/watchlist/${client.mondayItemId}/expand?insight=${encodeURIComponent(insight)}`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  return (
    <div className="border-b border-border/10 bg-muted/[0.04] px-5 py-5">
      {/* Open client — top-right of the panel */}
      <div className="flex justify-end mb-3">
        <Link
          href={`/clients/${client.mondayItemId}?from=watchlist`}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors whitespace-nowrap"
        >
          Open client
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* Chart side-by-side with Top ads — keeps the panel compact and gives both signals
          at the same eye-level. */}
      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 mb-4">
        <div className="rounded-md border border-border/30 bg-muted/10 px-3.5 py-3">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <CplChart trend={data?.dailyTrend} />
          )}
        </div>

        <ExpandPanel title="Top ads (30d)" subtitle="By spend · color = vs account avg CPL">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : data?.topAds.length ? (
            <ul className="space-y-1.5">
              {data.topAds.map((ad) => (
                <AdRow key={ad.adName} ad={ad} />
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground/50 italic">No ads with meaningful spend in the last 30d.</p>
          )}
        </ExpandPanel>
      </div>

      {/* AI activity summary — combines Monday lead board + Current Clients board + Trengo into one digest */}
      <ExpandPanel title="Activity summary" subtitle="Monday CRM · Current Clients board · Trengo (14d)">
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : data?.aiSummary ? (
          <div className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {data.aiSummary}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/50 italic">No client communication or CRM activity in the last 14d.</p>
        )}
      </ExpandPanel>
    </div>
  )
}

function ExpandPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/30 bg-muted/10 px-3.5 py-3">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">{title}</p>
        <p className="text-[9px] text-muted-foreground/40">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function AdRow({ ad }: { ad: WatchlistExpandResponse["topAds"][number] }) {
  const cplLabel = ad.leads > 0 && ad.cpl > 0 ? `€${ad.cpl.toFixed(2)}` : "—"
  // Verdict drives the CPL color. Neutral stays muted — only clear winners/losers
  // get a strong color so the eye actually trusts the signal.
  const cplColor =
    ad.verdict === "winner"
      ? "text-green-400"
      : ad.verdict === "loser"
        ? "text-red-400"
        : "text-muted-foreground"
  return (
    <li className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-foreground/80 truncate flex-1 min-w-0" title={ad.adName}>{ad.adName}</span>
      <span className="text-muted-foreground/60 tabular-nums shrink-0">€{ad.spend.toFixed(0)} · {ad.leads}L</span>
      <span className={`tabular-nums font-medium shrink-0 ${cplColor}`}>{cplLabel}</span>
    </li>
  )
}

/**
 * Compact "how long has this client been in this bucket" indicator. Sits inline next
 * to the client name. Three states:
 *   - Just landed today  → red NEW pill (attention-grabbing, transient)
 *   - 1–2 days           → muted "Nd" — recent, no alarm
 *   - 3–6 days           → amber "Nd" — sticky, watch out
 *   - 7+ days            → red "Nd" — stuck in the bucket, structural problem
 * Returns null when there's nothing meaningful to show (state still loading, or 0d
 * without the NEW signal). For Good clients we keep the visual subtle since long-good
 * is a positive signal but not urgent.
 */
function BucketAge({
  category,
  daysInBucket,
  isNewToday,
}: {
  category: WatchCategory
  daysInBucket: number | null
  isNewToday: boolean
}) {
  if (isNewToday) {
    return (
      <span className="inline-flex items-center rounded-sm px-1 py-px text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400">
        NEW
      </span>
    )
  }
  if (daysInBucket == null || daysInBucket <= 0) return null

  // Color emphasis only for Action / Watch — for Good a long stretch is good news, just
  // not something to highlight. No-data buckets don't show this at all (handled by caller).
  let toneClass = "text-muted-foreground/50"
  if (category === "action" || category === "watch") {
    if (daysInBucket >= 7) toneClass = "text-red-400 font-medium"
    else if (daysInBucket >= 3) toneClass = "text-amber-400"
    else toneClass = "text-muted-foreground/60"
  }

  return <span className={`text-[10px] tabular-nums ${toneClass}`}>{daysInBucket}d</span>
}

// --- Summary Header ---
//
// Targets-page-style summary: 4 KPI cards in a row + a Key Insights / Optimisation
// Proposal pair underneath. Each block uses the exact same card primitives (`bg-card
// rounded-lg p-5 border border-border/40`) and typography conventions as
// `targets/_components/hero-pillars.tsx` and `targets/_components/marketing-insights.tsx`
// so the watchlist feels like a first-class part of the same dashboard family.

type WatchlistKpiStatus = "good" | "bad" | "neutral"

function WatchlistKpiCard({
  label,
  value,
  subtitle,
  status,
  trendIcon,
}: {
  label: string
  value: string
  subtitle: string
  status: WatchlistKpiStatus
  trendIcon?: "up" | "down" | "flat"
}) {
  const valueColor = status === "good" ? "text-green-500" : status === "bad" ? "text-red-500" : "text-foreground"
  const Trend = trendIcon === "up" ? ArrowUp : trendIcon === "down" ? ArrowDown : Minus
  const trendColor = trendIcon === "up" ? "text-green-500" : trendIcon === "down" ? "text-red-500" : "text-muted-foreground/40"
  return (
    <div className="bg-card rounded-lg p-5 border border-border/40 flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
        {trendIcon && <Trend className={cn("h-3.5 w-3.5", trendColor)} strokeWidth={2.5} />}
      </div>
      <span className={cn("text-3xl font-bold font-mono leading-none tracking-tight", valueColor)}>{value}</span>
      <span className="text-xs text-muted-foreground leading-relaxed">{subtitle}</span>
    </div>
  )
}

function WatchlistKpiSkeletons() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-card rounded-lg p-5 border border-border/40">
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-8 w-24 mb-3" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  )
}

const INSIGHT_ICON: Record<"positive" | "warning" | "critical", { icon: typeof CheckCircle2; color: string }> = {
  positive: { icon: CheckCircle2, color: "text-green-500" },
  warning:  { icon: AlertCircle,  color: "text-yellow-500" },
  critical: { icon: AlertOctagon, color: "text-red-500" },
}

function WatchlistInsightsAndProposals({
  insights,
  proposals,
  isLoading,
}: {
  insights: WatchlistInsight[]
  proposals: string[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, idx) => (
          <div key={idx} className="bg-card rounded-lg p-5 border border-border/40">
            <Skeleton className="h-4 w-32 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Key Insights */}
      <div className="bg-card rounded-lg p-5 border border-border/40">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Key Insights</h3>
        </div>
        <div className="space-y-3">
          {insights.length === 0 ? (
            <p className="text-sm text-muted-foreground leading-relaxed">No notable patterns yet — wait for the next sync.</p>
          ) : (
            insights.map((insight, i) => {
              const { icon: Icon, color } = INSIGHT_ICON[insight.type]
              return (
                <div key={i} className="flex items-start gap-2.5">
                  <Icon className={cn("h-4 w-4 shrink-0 mt-px", color)} strokeWidth={2.25} />
                  <p className="text-sm text-foreground leading-relaxed">{insight.text}</p>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Optimisation Proposal */}
      <div className="bg-card rounded-lg p-5 border border-border/40">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Optimisation Proposal</h3>
        </div>
        <div className="space-y-3">
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground leading-relaxed">No proposals yet — wait for the next sync.</p>
          ) : (
            proposals.map((proposal, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-xs font-mono font-medium text-muted-foreground/60 shrink-0 mt-[3px] tabular-nums w-5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="text-sm text-foreground leading-relaxed">{proposal}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// --- Watch Section ---

function WatchSection({
  category,
  items,
  aiNotes,
  defaultOpen,
}: {
  category: "action" | "watch" | "good"
  items: CategorizedClient[]
  aiNotes: Record<string, string>
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const config = CATEGORY_CONFIG[category]
  const Icon = config.icon

  function toggleRow(id: string) {
    setExpandedRows((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (items.length === 0) return null

  return (
    <div>
      {/* Section header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2.5 w-full px-4 py-2.5 rounded-lg border ${config.headerBg} mb-3 transition-colors hover:opacity-80`}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
        <Icon className={`h-4 w-4 ${config.iconColor}`} />
        <span className="text-sm font-medium">{config.label}</span>
        <span className="text-xs text-muted-foreground/50 tabular-nums">{items.length}</span>
      </button>

      {open && (
        <div className="rounded-xl border border-border/30 overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(200px,2fr)_minmax(200px,2.5fr)_80px_60px_70px_60px_70px_32px] gap-x-4 px-5 py-2.5 border-b border-border/20 bg-muted/20">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Client</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Insight</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5 text-violet-400" />
              AI Note
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-right">Spend</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-right">Leads</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-right">CPL</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-right">Appts</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-right">14d CPL</span>
            <span />
          </div>

          {/* Rows */}
          {items.map(({ client, insight, kpi, daysInBucket, isNewToday }) => {
            const note = aiNotes[client.mondayItemId]
            const id = client.mondayItemId
            const isExpanded = expandedRows.has(id)

            return (
              <div key={id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleRow(id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      toggleRow(id)
                    }
                  }}
                  className={`grid grid-cols-[minmax(180px,1.2fr)_minmax(200px,2fr)_minmax(200px,2.5fr)_80px_60px_70px_60px_70px_32px] gap-x-4 px-5 py-3 border-b border-border/10 border-l-2 ${config.rowBorder} hover:bg-muted/20 transition-colors items-center cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40`}
                >
                  {/* Client */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{client.name}</p>
                      <BucketAge category={category} daysInBucket={daysInBucket} isNewToday={isNewToday} />
                    </div>
                    <p className="text-[10px] text-muted-foreground/40 truncate">
                      {[client.campaignManager, client.accountManager].filter(Boolean).join(" · ")}
                    </p>
                  </div>

                  {/* Insight */}
                  <p className={`text-xs leading-snug ${config.insightColor}`}>
                    {insight}
                  </p>

                  {/* AI Note */}
                  <div className="min-w-0">
                    {note ? (
                      <p className="text-[11px] text-muted-foreground leading-snug" title={note}>
                        {note}
                      </p>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/25 italic">Generating...</span>
                    )}
                  </div>

                  {/* Spend */}
                  <span className="text-xs tabular-nums text-muted-foreground text-right">
                    {kpi && kpi.adSpend > 0 ? fmtCurrency(kpi.adSpend) : "—"}
                  </span>

                  {/* Leads */}
                  <span className="text-xs tabular-nums font-medium text-right">
                    {kpi && kpi.leads > 0 ? kpi.leads : kpi && kpi.adSpend > 0 ? "0" : "—"}
                  </span>

                  {/* CPL */}
                  <span className="text-xs tabular-nums text-muted-foreground text-right">
                    {kpi && kpi.cpl > 0 ? `€${kpi.cpl.toFixed(2)}` : "—"}
                  </span>

                  {/* Appointments */}
                  <span className="text-xs tabular-nums text-muted-foreground text-right">
                    {kpi && kpi.appointments > 0 ? kpi.appointments : "—"}
                  </span>

                  {/* 14d CPL sparkline */}
                  <span className="flex items-center justify-end">
                    <CplSparkline trend={kpi?.dailyTrend} />
                  </span>

                  {/* Expand chevron */}
                  <span className="text-muted-foreground/40 flex justify-center">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </span>
                </div>

                {isExpanded && <ExpandedRow client={client} kpi={kpi} insight={insight} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- No Data Section ---
// Live clients that have no actionable performance metrics for the 7d window — picked up
// here so they're never silently dropped. Reasons surface inline: RL ad account with no
// campaigns selected, no Meta ad account configured, or genuinely no spend/leads this week.

function NoDataSection({
  items,
  defaultOpen,
}: {
  items: CategorizedClient[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (items.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 rounded-lg border bg-muted/20 border-border/30 mb-3 transition-colors hover:opacity-80"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
        <CircleDashed className="h-4 w-4 text-muted-foreground/60" />
        <span className="text-sm font-medium text-muted-foreground">No data</span>
        <span className="text-xs text-muted-foreground/50 tabular-nums">{items.length}</span>
        <span className="text-[11px] text-muted-foreground/40 ml-1">live in Monday but no usable Meta data this week</span>
      </button>

      {open && (
        <div className="rounded-xl border border-border/30 overflow-hidden">
          <div className="grid grid-cols-[minmax(180px,1.2fr)_1fr_32px] gap-x-4 px-5 py-2.5 border-b border-border/20 bg-muted/20">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Client</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Reason</span>
            <span />
          </div>

          {items.map(({ client, insight }) => (
            <Link
              key={client.mondayItemId}
              href={`/clients/${client.mondayItemId}?from=watchlist`}
              className="grid grid-cols-[minmax(180px,1.2fr)_1fr_32px] gap-x-4 px-5 py-3 border-b border-border/10 border-l-2 border-l-muted-foreground/30 hover:bg-muted/20 transition-colors items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground/80 truncate">{client.name}</p>
                <p className="text-[10px] text-muted-foreground/40 truncate">
                  {[client.campaignManager, client.accountManager].filter(Boolean).join(" · ")}
                </p>
              </div>

              <p className="text-xs text-muted-foreground/70 leading-snug">{insight}</p>

              <span className="text-muted-foreground/20 flex justify-center">
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main Dashboard ---

type Props = {
  clients: MondayClient[]
  userName: string
}

export function WatchListDashboard({ clients }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [cmFilter, setCmFilter] = useState("All")
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [aiNotes, setAiNotes] = useState<Record<string, string>>({})
  const aiGenerating = useRef(false)

  const campaignManagers = useMemo(() => uniqueSorted(clients.map((c) => c.campaignManager)), [clients])

  const filteredClients = useMemo(
    () => cmFilter === "All" ? clients : clients.filter((c) => c.campaignManager === cmFilter),
    [clients, cmFilter]
  )

  const kpiClients = useMemo(
    () =>
      filteredClients
        .filter((c) => c.metaAdAccountId || c.clientBoardId)
        .map((c) => ({
          mondayItemId: c.mondayItemId,
          metaAdAccountId: c.metaAdAccountId || null,
          clientBoardId: c.clientBoardId || null,
        })),
    [filteredClients]
  )

  const kpiQuery = useQuery<Record<string, KpiSummary>>({
    queryKey: ["kpi-summaries", kpiClients.map((c) => c.mondayItemId)],
    queryFn: () =>
      fetch("/api/kpi-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: kpiClients }),
      }).then((r) => r.json()),
    enabled: kpiClients.length > 0,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const lastUpdated = kpiQuery.dataUpdatedAt
    ? new Date(kpiQuery.dataUpdatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null

  // Watch List bucket state — written by the cron, read here to render Days indicator,
  // NEW badge, and yesterday-vs-today score trend.
  const stateQuery = useQuery<WatchlistStateResponse>({
    queryKey: ["watchlist-state"],
    queryFn: () => fetch("/api/watchlist/state").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  function daysBetween(fromIso: string, toIso: string): number {
    // Date strings are YYYY-MM-DD UTC — use UTC math to avoid DST drift.
    const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10))
    const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10))
    return Math.max(0, Math.floor((b - a) / 86400000))
  }

  // Categorize
  const categorized = useMemo(() => {
    const action: CategorizedClient[] = []
    const watch: CategorizedClient[] = []
    const good: CategorizedClient[] = []
    const noData: CategorizedClient[] = []
    const stateMap = stateQuery.data ?? {}

    function buildItem(client: MondayClient, category: WatchCategory, insight: string, kpi: KpiSummary | undefined, severity: number): CategorizedClient {
      const state = stateMap[client.mondayItemId]
      const stateMatchesCategory = state?.category === category
      // Days only meaningful when the cron-recorded state agrees with what we're rendering
      // right now. If the UI computed a different bucket than the state row holds (e.g.
      // mid-cron-run, or live data flipped), we'd rather show no day count than a wrong one.
      const daysInBucket = stateMatchesCategory ? daysBetween(state!.sinceDate, today) : null
      const isNewToday = stateMatchesCategory && state!.sinceDate === today
      const prevCategory = stateMatchesCategory ? (state!.prevCategory as WatchCategory | null) : null
      return { client, category, insight, kpi, severity, daysInBucket, isNewToday, prevCategory }
    }

    for (const client of filteredClients) {
      const kpi = kpiQuery.data?.[client.mondayItemId]
      const { category, insight } = categorize(client, kpi)
      const severity = kpi ? severityScore(kpi) : 0
      const gaps = getSetupGaps(client)

      if (category === "action") action.push(buildItem(client, category, insight, kpi, severity))
      else if (category === "watch") watch.push(buildItem(client, category, insight, kpi, severity))
      else if (category === "good") good.push(buildItem(client, category, insight, kpi, severity))
      else if (category === "no-data") {
        // Already a no-data client — append any Stripe/Trengo gap to the existing reason
        // so the CM sees both "no spend this week" + "Stripe missing" in one row.
        const augmented = gaps.length > 0 ? `${insight} · ${gaps.join(" + ")} missing` : insight
        noData.push(buildItem(client, category, augmented, kpi, severity))
      }

      // Surface setup gaps even when performance data exists. These intentionally appear
      // in BOTH the performance bucket (Action/Watch/Good) and in No Data — Roy explicitly
      // wants admin gaps prominently visible regardless of campaign performance.
      if (category !== "no-data" && gaps.length > 0) {
        noData.push(buildItem(client, "no-data", `${gaps.join(" + ")} missing — admin setup incomplete`, kpi, 0))
      }
    }

    // Action & Watch: rank by severity (worst first → drop everything at the top).
    // Days-in-bucket is the tiebreaker so longer-stuck clients edge out fresher entries
    // when their financial impact is similar.
    const sortByImpact = (a: CategorizedClient, b: CategorizedClient) => {
      if (b.severity !== a.severity) return b.severity - a.severity
      return (b.daysInBucket ?? 0) - (a.daysInBucket ?? 0)
    }
    action.sort(sortByImpact)
    watch.sort(sortByImpact)
    good.sort((a, b) => (b.kpi?.leads ?? 0) - (a.kpi?.leads ?? 0))
    noData.sort((a, b) => a.client.name.localeCompare(b.client.name))

    return { action, watch, good, noData }
  }, [filteredClients, kpiQuery.data, stateQuery.data, today])

  // Health score for the summary header. Excludes no-data so setup gaps don't water down
  // the percentage (Roy: "die wil ik niet dat die de data beïnvloed").
  const healthScore = useMemo(() => {
    const total = categorized.action.length + categorized.watch.length + categorized.good.length
    return total > 0 ? Math.round((categorized.good.length / total) * 100) : 0
  }, [categorized])

  // Yesterday's bucket counts, reconstructed from the state table. For each client whose
  // since_date === today, prev_category was their bucket yesterday; otherwise category is.
  // Then we filter to the same CM scope and tally.
  const yesterdayTotals = useMemo(() => {
    const stateMap = stateQuery.data ?? {}
    const totals = { action: 0, watch: 0, good: 0, noData: 0 }
    for (const client of filteredClients) {
      const state = stateMap[client.mondayItemId]
      if (!state) continue
      const yCat: WatchCategory | null = state.sinceDate === today ? state.prevCategory : state.category
      if (yCat === "action") totals.action++
      else if (yCat === "watch") totals.watch++
      else if (yCat === "good") totals.good++
      else if (yCat === "no-data") totals.noData++
    }
    return totals
  }, [filteredClients, stateQuery.data, today])

  // 7-day rolling history for the "vs 7d avg" KPI card. Cron writes one snapshot per
  // day; here we read the trailing 14 to compute a 7d average score per filter scope.
  const scoreHistoryQuery = useQuery<WatchlistScoreHistoryResponse>({
    queryKey: ["watchlist-score-history"],
    queryFn: () => fetch("/api/watchlist/score-history").then((r) => r.json()),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const healthScore7dAvg = useMemo(() => {
    const history = scoreHistoryQuery.data?.history ?? {}
    const scopeKey = cmFilter === "All" ? "_all" : cmFilter
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const cutoffStr = sevenDaysAgo.toISOString().slice(0, 10)
    const todayStr = today
    const scores: number[] = []
    for (const [date, snap] of Object.entries(history)) {
      // Strict 7-day window: dates after cutoff and before today (exclusive of today
      // so the comparison isn't "today vs 7-day avg-incl-today").
      if (date <= cutoffStr || date >= todayStr) continue
      const totals = snap[scopeKey]
      if (!totals) continue
      const t = totals.action + totals.watch + totals.good
      if (t > 0) scores.push((totals.good / t) * 100)
    }
    if (scores.length === 0) return null
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  }, [scoreHistoryQuery.data, cmFilter, today])

  // Average CPL across all currently-live clients (action + watch + good). Computed as
  // SUM(spend) / SUM(leads) so the metric is weighted by spend — a single high-spend
  // client doesn't get drowned out by many low-spend clients with extreme CPLs.
  const avgCpl = useMemo(() => {
    const liveClients = [...categorized.action, ...categorized.watch, ...categorized.good]
    let totalSpend = 0
    let totalLeads = 0
    for (const c of liveClients) {
      if (!c.kpi) continue
      totalSpend += c.kpi.adSpend
      totalLeads += c.kpi.leads
    }
    return totalLeads > 0 ? totalSpend / totalLeads : null
  }, [categorized])

  // AI narrative — recomputes when the filter scope changes. Rate-limited via 1h cache key
  // server-side so a CM scrolling through filters doesn't blow the LLM budget.
  const narrativePayload = useMemo(() => {
    const totals = {
      action: categorized.action.length,
      watch: categorized.watch.length,
      good: categorized.good.length,
      noData: categorized.noData.length,
    }
    const allBuckets = [...categorized.action, ...categorized.watch, ...categorized.good]
    return {
      scope: cmFilter,
      totals,
      totalsYesterday: yesterdayTotals,
      clients: allBuckets.map((c) => ({
        id: c.client.mondayItemId,
        name: c.client.name,
        category: c.category as "action" | "watch" | "good",
        insight: c.insight,
        daysInBucket: c.daysInBucket,
        isNewToday: c.isNewToday,
        prevCategory: c.prevCategory,
      })),
    }
  }, [categorized, yesterdayTotals, cmFilter])

  const narrativeQuery = useQuery<WatchlistNarrativeResponse>({
    queryKey: ["watchlist-narrative", cmFilter, today, narrativePayload.totals.action, narrativePayload.totals.watch, narrativePayload.totals.good],
    queryFn: () =>
      fetch("/api/watchlist/narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(narrativePayload),
      }).then((r) => r.json()),
    enabled: !kpiQuery.isLoading && !stateQuery.isLoading && narrativePayload.clients.length > 0,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Auto-generate AI notes
  const allCategorized = useMemo(
    () => [...categorized.action, ...categorized.watch, ...categorized.good],
    [categorized]
  )

  useEffect(() => {
    if (allCategorized.length === 0 || aiGenerating.current || !kpiQuery.data) return

    const clientsForAi = allCategorized
      .filter((c) => c.kpi && (c.kpi.adSpend > 0 || c.kpi.leads > 0))
      .map((c) => ({
        id: c.client.mondayItemId,
        name: c.client.name,
        category: c.category as "action" | "watch" | "good",
        issue: c.insight,
        adSpend: c.kpi?.adSpend ?? 0,
        leads: c.kpi?.leads ?? 0,
        cpl: c.kpi?.cpl ?? 0,
        prevCpl: c.kpi?.prevCpl ?? 0,
        appointments: c.kpi?.appointments ?? 0,
        costPerAppointment: c.kpi?.costPerAppointment ?? 0,
        prevCostPerAppointment: c.kpi?.prevCostPerAppointment ?? 0,
        // Tells the AI whether appointment data is real-zero vs unknown-because-CRM-missing
        mondayCrmConnected: c.kpi?.mondayCrmConnected ?? false,
        leadsFromMetaFallback: c.kpi?.metaFallback ?? false,
        hasClientBoardId: !!c.client.clientBoardId,
      }))

    if (clientsForAi.length === 0) return

    aiGenerating.current = true

    fetch("/api/watchlist-summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clients: clientsForAi }),
    })
      .then((r) => r.ok ? r.json() : {})
      .then((notes: Record<string, string>) => {
        if (Object.keys(notes).length > 0) setAiNotes(notes)
      })
      .catch(() => {})
      .finally(() => { aiGenerating.current = false })
  }, [allCategorized, kpiQuery.data]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRefresh() {
    setIsRefreshing(true)
    aiGenerating.current = false
    setAiNotes({})
    router.refresh()
    // Bypass the kpi_summaries cache (Meta/Monday live fetch). The endpoint
    // re-writes the cache on success so other consumers see the fresh data too.
    try {
      const fresh: Record<string, KpiSummary> = await fetch("/api/kpi-summaries?force=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: kpiClients }),
        cache: "no-store",
      }).then((r) => r.json())
      queryClient.setQueryData<Record<string, KpiSummary>>(
        ["kpi-summaries", kpiClients.map((c) => c.mondayItemId)],
        fresh,
      )
    } finally {
      setIsRefreshing(false)
    }
  }

  const isFetching = kpiQuery.isFetching || isRefreshing

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-heading font-semibold tracking-tight">Watch List</h1>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-[11px] text-muted-foreground/40">Updated {lastUpdated}</span>
            )}
            <button
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-all"
              onClick={handleRefresh}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Campaign performance monitor — {filteredClients.length} active clients
        </p>
      </div>

      {/* Summary pills + CM filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-red-500/10 text-red-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            Action
            <span className="tabular-nums">{categorized.action.length}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-amber-500/10 text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Watch
            <span className="tabular-nums">{categorized.watch.length}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-green-500/10 text-green-500">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Good
            <span className="tabular-nums">{categorized.good.length}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-muted/40 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            No data
            <span className="tabular-nums">{categorized.noData.length}</span>
          </div>
        </div>

        <Select value={cmFilter} onValueChange={(v) => setCmFilter(v ?? "All")}>
          <SelectTrigger className="!h-8 !w-auto !min-w-[140px] !border-0 !bg-muted/40 !rounded-lg !text-xs !px-3 !shadow-none dark:!bg-white/5">
            <SelectValue>{cmFilter === "All" ? "All Campaign Managers" : cmFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Campaign Managers</SelectItem>
            {campaignManagers.map((cm) => (
              <SelectItem key={cm} value={cm}>{cm}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 4 KPI cards — same primitive as the Targets HeroPillars so the watchlist reads
          as the same product family. */}
      {kpiQuery.isLoading || stateQuery.isLoading ? (
        <WatchlistKpiSkeletons />
      ) : (
        (() => {
          const total = categorized.action.length + categorized.watch.length + categorized.good.length

          // Card 1 — health score (today). Color-coded by zone so 43% reads as "below
          // target" without needing a label.
          const scoreStatus: WatchlistKpiStatus =
            total === 0 ? "neutral" : healthScore < 50 ? "bad" : healthScore < 75 ? "neutral" : "good"

          // Card 2 — vs 7d avg. Cron-fed, so it stays "—" on the very first day after
          // deploy and starts being meaningful from day 3 or 4 onwards.
          const avg7d = healthScore7dAvg
          const delta7d = avg7d != null ? healthScore - avg7d : null
          const trend7d: "up" | "down" | "flat" | undefined =
            delta7d == null ? undefined : delta7d > 1 ? "up" : delta7d < -1 ? "down" : "flat"
          const status7d: WatchlistKpiStatus =
            delta7d == null ? "neutral" : delta7d > 1 ? "good" : delta7d < -1 ? "bad" : "neutral"
          const value7d = delta7d == null
            ? "—"
            : delta7d === 0
              ? "0pp"
              : `${delta7d > 0 ? "+" : ""}${delta7d}pp`
          const subtitle7d = avg7d == null
            ? "Building 7-day baseline…"
            : `7-day average: ${avg7d}%`

          // Card 3 — Healthy clients ratio. Always neutral status (it's a fact, not a verdict).
          const valueHealthy = total === 0 ? "—" : `${categorized.good.length}/${total}`
          const subtitleHealthy = total === 0 ? "No clients in scope" : "in good performance"

          // Card 4 — Average CPL across live clients (weighted by spend).
          const valueCpl = avgCpl == null
            ? "—"
            : `€${avgCpl.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          const liveCount = categorized.action.length + categorized.watch.length + categorized.good.length
          const subtitleCpl = avgCpl == null
            ? "No spend with leads in 7d"
            : `across ${liveCount} live ${liveCount === 1 ? "client" : "clients"} (7d)`

          return (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <WatchlistKpiCard
                label="Health score"
                value={total === 0 ? "—" : `${healthScore}%`}
                subtitle={total === 0 ? "No clients in scope" : "target ≥ 75%"}
                status={scoreStatus}
              />
              <WatchlistKpiCard
                label="Vs 7-day avg"
                value={value7d}
                subtitle={subtitle7d}
                status={status7d}
                trendIcon={trend7d}
              />
              <WatchlistKpiCard
                label="Healthy clients"
                value={valueHealthy}
                subtitle={subtitleHealthy}
                status="neutral"
              />
              <WatchlistKpiCard
                label="Avg CPL"
                value={valueCpl}
                subtitle={subtitleCpl}
                status="neutral"
              />
            </div>
          )
        })()
      )}

      {/* Key Insights + Optimisation Proposal — same component contract as the Targets
          page MarketingInsights so the visual rhythm is identical. */}
      <WatchlistInsightsAndProposals
        insights={narrativeQuery.data?.insights ?? []}
        proposals={narrativeQuery.data?.proposals ?? []}
        isLoading={narrativeQuery.isLoading || narrativeQuery.isFetching}
      />

      {/* Sections */}
      <div className="space-y-6">
        <WatchSection
          category="action"
          items={categorized.action}
          aiNotes={aiNotes}
          defaultOpen={true}
        />
        <WatchSection
          category="watch"
          items={categorized.watch}
          aiNotes={aiNotes}
          defaultOpen={true}
        />
        <NoDataSection
          items={categorized.noData}
          defaultOpen={false}
        />
        <WatchSection
          category="good"
          items={categorized.good}
          aiNotes={aiNotes}
          defaultOpen={false}
        />
      </div>
    </div>
  )
}
