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
import { RefreshCw, AlertCircle, TrendingUp, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Sparkles, CircleDashed } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { WatchlistExpandResponse } from "@/app/api/watchlist/[id]/expand/route"

// --- Categorization ---

type WatchCategory = "action" | "watch" | "good" | "no-data"

type CategorizedClient = {
  client: MondayClient
  category: WatchCategory
  insight: string
  kpi: KpiSummary | undefined
  /** Severity score used to rank within Action/Watch — higher = more urgent */
  severity: number
}

/**
 * Tiered Watch/Action thresholds based on actual 7d ad spend.
 * Smaller accounts have inherently noisier week-over-week swings; larger accounts
 * deserve a more sensitive signal because % moves on big spend = real € lost.
 */
function getThresholds(adSpend7d: number): { watchPct: number; actionPct: number } {
  if (adSpend7d < 250) return { watchPct: 15, actionPct: 40 }
  if (adSpend7d < 1000) return { watchPct: 10, actionPct: 30 }
  return { watchPct: 5, actionPct: 20 }
}

/**
 * Severity score for ranking within Action/Watch buckets.
 *   score = adSpend × max(worstCostDelta_pct / 30, 1) × (zero-leads-with-spend ? 3 : 1)
 * Bigger spend × bigger CPL/CPA spike floats to the top. Zero-leads-with-spend is
 * pure waste, so it gets a 3× multiplier on raw spend.
 */
function severityScore(kpi: KpiSummary): number {
  const spend = kpi.adSpend
  if (spend > 50 && kpi.leads === 0) return spend * 3

  const cplPct = kpi.prevCpl > 0 ? Math.abs((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100 : 0
  const cpaPct = kpi.prevCostPerAppointment > 0
    ? Math.abs((kpi.costPerAppointment - kpi.prevCostPerAppointment) / kpi.prevCostPerAppointment) * 100
    : 0
  const worstPct = Math.max(cplPct, cpaPct)
  return spend * Math.max(worstPct / 30, 1)
}

function categorize(client: MondayClient, kpi: KpiSummary | undefined): { category: WatchCategory; insight: string } {
  // Skip clients with RL ad account but no selected campaigns (bogus data)
  if (kpi?.rlAccountNoCampaign) {
    return { category: "no-data", insight: "No campaigns selected" }
  }

  if (!kpi || (kpi.adSpend === 0 && kpi.leads === 0)) {
    return { category: "no-data", insight: "No data" }
  }

  // Action: spend with zero leads
  if (kpi.adSpend > 50 && kpi.leads === 0) {
    return { category: "action", insight: `€${kpi.adSpend.toFixed(0)} spent, 0 leads in 7d` }
  }

  // CPL trend analysis
  const hasCplTrend = kpi.cpl > 0 && kpi.prevCpl > 0
  const cplPct = hasCplTrend ? ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100 : 0

  // CPA trend analysis
  const hasCpaTrend = kpi.costPerAppointment > 0 && kpi.prevCostPerAppointment > 0
  const cpaPct = hasCpaTrend ? ((kpi.costPerAppointment - kpi.prevCostPerAppointment) / kpi.prevCostPerAppointment) * 100 : 0

  // Tiered thresholds based on this client's 7d spend
  const { watchPct, actionPct } = getThresholds(kpi.adSpend)

  // Action: CPL or CPA spiked above the action threshold
  if (hasCplTrend && cplPct >= actionPct) {
    return { category: "action", insight: `CPL up ${cplPct.toFixed(0)}% — €${kpi.cpl.toFixed(2)} vs €${kpi.prevCpl.toFixed(2)} prev week` }
  }
  if (hasCpaTrend && cpaPct >= actionPct) {
    return { category: "action", insight: `CPA up ${cpaPct.toFixed(0)}% — €${kpi.costPerAppointment.toFixed(0)} vs €${kpi.prevCostPerAppointment.toFixed(0)} prev week` }
  }

  // Watch: CPL or CPA rising between watch and action thresholds
  if (hasCplTrend && cplPct >= watchPct) {
    return { category: "watch", insight: `CPL rising ${cplPct.toFixed(0)}% — €${kpi.cpl.toFixed(2)} from €${kpi.prevCpl.toFixed(2)}` }
  }
  if (hasCpaTrend && cpaPct >= watchPct) {
    return { category: "watch", insight: `CPA rising ${cpaPct.toFixed(0)}% — €${kpi.costPerAppointment.toFixed(0)} from €${kpi.prevCostPerAppointment.toFixed(0)}` }
  }

  // Good: has leads, CPL stable or declining
  if (kpi.leads > 0) {
    const parts: string[] = []

    if (hasCplTrend && cplPct < -10) {
      parts.push(`CPL dropped ${Math.abs(cplPct).toFixed(0)}% to €${kpi.cpl.toFixed(2)}`)
    } else if (hasCplTrend && cplPct >= -10 && cplPct < 10) {
      parts.push(`CPL stable at €${kpi.cpl.toFixed(2)}`)
    } else if (kpi.cpl > 0) {
      parts.push(`CPL €${kpi.cpl.toFixed(2)}`)
    }

    parts.push(`${kpi.leads} leads from €${kpi.adSpend.toFixed(0)} spend`)

    if (kpi.appointments > 0) {
      parts.push(`${kpi.appointments} appts`)
    }

    return { category: "good", insight: parts.join(" · ") }
  }

  return { category: "good", insight: "Running — no leads yet" }
}

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

// API IDs we surface as "open" setup gaps. Monday board ID is intentionally
// excluded — it has a Meta-fallback path so it isn't a setup blocker.
function getMissingIds(client: MondayClient): string[] {
  const missing: string[] = []
  if (!client.metaAdAccountId) missing.push("Meta Ad Account")
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
      <div className="flex items-start justify-between gap-6 mb-5">
        {/* CPL chart — uses live trend from the expand endpoint, not the parent KpiSummary,
            so it works even when the kpi-summaries cache predates the dailyTrend field. */}
        <div className="min-w-0 flex-1 max-w-[320px]">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <CplChart trend={data?.dailyTrend} />
          )}
        </div>

        {/* Open full client page */}
        <Link
          href={`/clients/${client.mondayItemId}?from=watchlist`}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors whitespace-nowrap"
        >
          Open client
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* Top winners + losers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <ExpandPanel title="Top winners (30d)" subtitle="Lowest CPL · ≥3 leads">
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : data?.winningAds.length ? (
            <ul className="space-y-1.5">
              {data.winningAds.map((ad) => (
                <AdRow key={ad.adName} ad={ad} kind="winner" />
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground/50 italic">No qualifying ads in the last 30d.</p>
          )}
        </ExpandPanel>

        <ExpandPanel title="Top losers (30d)" subtitle="Highest CPL · ≥€50 spend">
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : data?.losingAds.length ? (
            <ul className="space-y-1.5">
              {data.losingAds.map((ad) => (
                <AdRow key={ad.adName} ad={ad} kind="loser" />
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground/50 italic">No qualifying ads in the last 30d.</p>
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

function AdRow({ ad, kind }: { ad: WatchlistExpandResponse["winningAds"][number]; kind: "winner" | "loser" }) {
  const cplLabel = ad.leads > 0 && ad.cpl > 0 ? `€${ad.cpl.toFixed(2)}` : "—"
  const cplColor = kind === "winner" ? "text-green-400" : "text-red-400"
  return (
    <li className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-foreground/80 truncate flex-1 min-w-0" title={ad.adName}>{ad.adName}</span>
      <span className="text-muted-foreground/60 tabular-nums shrink-0">€{ad.spend.toFixed(0)} · {ad.leads}L</span>
      <span className={`tabular-nums font-medium shrink-0 ${cplColor}`}>{cplLabel}</span>
    </li>
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
          {items.map(({ client, insight, kpi }) => {
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
                    <p className="text-sm font-medium truncate">{client.name}</p>
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

// --- Open Section (setup gaps) ---

type OpenItem = { client: MondayClient; missingIds: string[] }

function OpenSection({
  items,
  defaultOpen,
}: {
  items: OpenItem[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (items.length === 0) return null

  return (
    <div>
      {/* Section header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 rounded-lg border bg-muted/20 border-border/30 mb-3 transition-colors hover:opacity-80"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
        <CircleDashed className="h-4 w-4 text-muted-foreground/60" />
        <span className="text-sm font-medium text-muted-foreground">Open</span>
        <span className="text-xs text-muted-foreground/50 tabular-nums">{items.length}</span>
        <span className="text-[11px] text-muted-foreground/40 ml-1">setup incomplete — data is partial</span>
      </button>

      {open && (
        <div className="rounded-xl border border-border/30 overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[minmax(180px,1.2fr)_1fr_32px] gap-x-4 px-5 py-2.5 border-b border-border/20 bg-muted/20">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Client</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Missing IDs</span>
            <span />
          </div>

          {/* Rows */}
          {items.map(({ client, missingIds }) => (
            <Link
              key={client.mondayItemId}
              href={`/clients/${client.mondayItemId}?from=watchlist`}
              className="grid grid-cols-[minmax(180px,1.2fr)_1fr_32px] gap-x-4 px-5 py-3 border-b border-border/10 border-l-2 border-l-muted-foreground/30 hover:bg-muted/20 transition-colors items-center"
            >
              {/* Client */}
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground/80 truncate">{client.name}</p>
                <p className="text-[10px] text-muted-foreground/40 truncate">
                  {[client.campaignManager, client.accountManager].filter(Boolean).join(" · ")}
                </p>
              </div>

              {/* Missing IDs as chips */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {missingIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-muted/40 text-muted-foreground/70"
                  >
                    {id} missing
                  </span>
                ))}
              </div>

              {/* External icon */}
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

  // Categorize
  const categorized = useMemo(() => {
    const action: CategorizedClient[] = []
    const watch: CategorizedClient[] = []
    const good: CategorizedClient[] = []
    const open: OpenItem[] = []

    for (const client of filteredClients) {
      const kpi = kpiQuery.data?.[client.mondayItemId]
      const { category, insight } = categorize(client, kpi)
      const severity = kpi ? severityScore(kpi) : 0
      const item: CategorizedClient = { client, category, insight, kpi, severity }

      if (category === "action") action.push(item)
      else if (category === "watch") watch.push(item)
      else if (category === "good") good.push(item)

      // Setup gaps are tracked independently — a client can appear in both
      // a performance bucket (with whatever data is available) and Open.
      const missingIds = getMissingIds(client)
      if (missingIds.length > 0) {
        open.push({ client, missingIds })
      }
    }

    // Action & Watch: rank by severity (worst first → drop everything at the top).
    // Good: keep the existing "biggest contributors first" ordering.
    action.sort((a, b) => b.severity - a.severity)
    watch.sort((a, b) => b.severity - a.severity)
    good.sort((a, b) => (b.kpi?.leads ?? 0) - (a.kpi?.leads ?? 0))
    open.sort((a, b) => b.missingIds.length - a.missingIds.length || a.client.name.localeCompare(b.client.name))

    return { action, watch, good, open }
  }, [filteredClients, kpiQuery.data])

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
            Open
            <span className="tabular-nums">{categorized.open.length}</span>
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
        <OpenSection
          items={categorized.open}
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
