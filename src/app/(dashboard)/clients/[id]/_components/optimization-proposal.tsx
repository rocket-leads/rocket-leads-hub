"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { scoreRows } from "./ad-performance"
import type { KpiResult, UtmRow } from "@/lib/clients/kpis"

type ScoredRow = UtmRow & {
  takenCallRate: number
  bookingRate: number
  dealRate: number
  reliability: "high" | "medium" | "low"
  category: "winner" | "sniper" | "fake" | "garbage"
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(0)}%`
}

function fmtEur(n: number) {
  return `€${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

function ReliabilityBadge({ level }: { level: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-green-500/15 text-green-600 dark:text-green-400",
    medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    low: "bg-muted text-muted-foreground",
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[level]}`}>
      {level === "high" ? "Reliable" : level === "medium" ? "Limited data" : "Low data"}
    </span>
  )
}

const TIMEFRAMES = [
  { key: "3d", label: "Last 3 days", days: 3 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "14d", label: "Last 14 days", days: 14 },
  { key: "30d", label: "Last 30 days", days: 30 },
] as const

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getDateRange(days: number) {
  const now = new Date()
  const end = toISO(now)
  const start = new Date(now)
  start.setDate(start.getDate() - (days - 1))
  return { startDate: toISO(start), endDate: end }
}

type TimeframeData = {
  key: string
  label: string
  days: number
  kpis: KpiResult | null
  scored: ScoredRow[] | null
  isLoading: boolean
}

function useTimeframeKpis(
  mondayItemId: string,
  metaAdAccountId: string | null,
  clientBoardId: string | null,
  selectedCampaignIds: string[],
  days: number,
) {
  const { startDate, endDate } = useMemo(() => getDateRange(days), [days])

  return useQuery<KpiResult>({
    queryKey: ["optimization-kpis", mondayItemId, days, selectedCampaignIds],
    queryFn: () => {
      const p = new URLSearchParams({
        startDate,
        endDate,
        ...(metaAdAccountId ? { adAccountId: metaAdAccountId } : {}),
        ...(clientBoardId ? { clientBoardId } : {}),
        ...(selectedCampaignIds.length > 0 ? { selectedCampaignIds: selectedCampaignIds.join(",") } : {}),
      })
      return fetch(`/api/clients/${mondayItemId}/kpis?${p}`).then((r) => r.json())
    },
    enabled: !!mondayItemId,
    staleTime: 5 * 60 * 1000,
  })
}

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
  selectedCampaignIds: string[]
}

export function OptimizationProposal({ mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds }: Props) {
  const q3d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 3)
  const q7d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 7)
  const q14d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 14)
  const q30d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 30)

  const queries = [q3d, q7d, q14d, q30d]
  const isLoading = queries.some((q) => q.isLoading)
  const allFailed = queries.every((q) => q.isError)

  const timeframes: TimeframeData[] = TIMEFRAMES.map((tf, i) => {
    const q = queries[i]
    const scored = q.data ? scoreRows(q.data.utmBreakdown ?? []) : null
    return { ...tf, kpis: q.data ?? null, scored, isLoading: q.isLoading }
  })

  // Aggregate recommendations across timeframes, prioritising short-term signals
  const recommendations = useMemo(() => {
    const adMap = new Map<string, {
      utm: string
      scaleCount: number
      reduceCount: number
      monitorCount: number
      bestTimeframe: string
      bestRow: ScoredRow | null
      worstRow: ScoredRow | null
      timeframeDetails: { label: string; category: string; leads: number; takenCalls: number; takenCallRate: number; reliability: string }[]
    }>()

    for (const tf of timeframes) {
      if (!tf.scored) continue
      for (const row of tf.scored) {
        if (!adMap.has(row.utm)) {
          adMap.set(row.utm, {
            utm: row.utm,
            scaleCount: 0,
            reduceCount: 0,
            monitorCount: 0,
            bestTimeframe: tf.label,
            bestRow: null,
            worstRow: null,
            timeframeDetails: [],
          })
        }
        const entry = adMap.get(row.utm)!

        if ((row.category === "winner" || row.category === "sniper") && row.takenCalls >= 1) {
          entry.scaleCount++
          if (!entry.bestRow || row.takenCallRate > entry.bestRow.takenCallRate) {
            entry.bestRow = row
            entry.bestTimeframe = tf.label
          }
        } else if ((row.category === "fake" || row.category === "garbage") && row.leads >= 3) {
          entry.reduceCount++
          if (!entry.worstRow || row.leads > entry.worstRow.leads) {
            entry.worstRow = row
          }
        } else {
          entry.monitorCount++
        }

        entry.timeframeDetails.push({
          label: tf.label,
          category: row.category,
          leads: row.leads,
          takenCalls: row.takenCalls,
          takenCallRate: row.takenCallRate,
          reliability: row.reliability,
        })
      }
    }

    const scale: typeof adMap extends Map<string, infer V> ? (V & { confidence: string })[] : never[] = []
    const reduce: typeof scale = []
    const monitor: typeof scale = []

    for (const entry of adMap.values()) {
      const total = entry.scaleCount + entry.reduceCount + entry.monitorCount
      const scaleRatio = entry.scaleCount / total
      const reduceRatio = entry.reduceCount / total

      // Check short-term (3d, 7d) trend specifically
      const shortTerm = entry.timeframeDetails.filter((d) => d.label === "Last 3 days" || d.label === "Last 7 days")
      const shortTermScale = shortTerm.filter((d) => d.category === "winner" || d.category === "sniper").length
      const shortTermReduce = shortTerm.filter((d) => d.category === "fake" || d.category === "garbage").length

      let confidence: string
      if (total >= 3) confidence = "High"
      else if (total >= 2) confidence = "Medium"
      else confidence = "Low"

      const item = { ...entry, confidence }

      // Prioritise short-term signals — if recent data says scale, scale; if recent says reduce, reduce
      if (shortTermScale > 0 && scaleRatio >= 0.4) {
        scale.push(item)
      } else if (shortTermReduce > 0 && reduceRatio >= 0.4) {
        reduce.push(item)
      } else if (scaleRatio > reduceRatio && entry.scaleCount > 0) {
        scale.push(item)
      } else if (reduceRatio > scaleRatio && entry.reduceCount > 0) {
        reduce.push(item)
      } else {
        monitor.push(item)
      }
    }

    // Sort by most evidence first
    scale.sort((a, b) => b.scaleCount - a.scaleCount)
    reduce.sort((a, b) => b.reduceCount - a.reduceCount)

    return { scale, reduce, monitor }
  }, [timeframes])

  if (allFailed) return null

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-96 mt-1" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const hasData = timeframes.some((tf) => tf.scored && tf.scored.length > 0)
  if (!hasData) return null

  const { scale, reduce, monitor } = recommendations

  // Get overall ROI from 30d data
  const kpis30d = q30d.data
  const hasRoi = kpis30d && kpis30d.roi > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Campaign Optimisation Proposal</CardTitle>
        <p className="text-xs text-muted-foreground">
          Cross-timeframe analysis (3d, 7d, 14d, 30d). Prioritises recent performance and conversion quality over lead volume.
          {hasRoi && ` 30-day ROI: ${kpis30d.roi.toFixed(2)}x (${fmtEur(kpis30d.revenue)} revenue on ${fmtEur(kpis30d.adSpend)} spend).`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {scale.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm font-medium">Increase budget</span>
            </div>
            <div className="space-y-2">
              {scale.map((entry) => (
                <div key={entry.utm} className="rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs break-all text-foreground">{entry.utm}</span>
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-500/15 text-green-600 dark:text-green-400">
                      {entry.confidence} confidence
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Classified as scalable in {entry.scaleCount} of {entry.scaleCount + entry.reduceCount + entry.monitorCount} timeframes.
                    {entry.bestRow && ` Best: ${entry.bestTimeframe} — ${entry.bestRow.takenCalls} taken call${entry.bestRow.takenCalls !== 1 ? "s" : ""} (${fmtPct(entry.bestRow.takenCallRate)} rate), ${entry.bestRow.leads} leads.`}
                    {entry.bestRow?.deals && entry.bestRow.deals > 0 && ` ${entry.bestRow.deals} deal${entry.bestRow.deals !== 1 ? "s" : ""} closed${entry.bestRow.revenue > 0 ? ` (${fmtEur(entry.bestRow.revenue)})` : ""}.`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {entry.timeframeDetails.map((d) => (
                      <TimeframePill key={d.label} detail={d} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {reduce.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="text-sm font-medium">Decrease budget</span>
            </div>
            <div className="space-y-2">
              {reduce.map((entry) => (
                <div key={entry.utm} className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs break-all text-foreground">{entry.utm}</span>
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-600 dark:text-red-400">
                      {entry.confidence} confidence
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Underperforming in {entry.reduceCount} of {entry.scaleCount + entry.reduceCount + entry.monitorCount} timeframes.
                    {entry.worstRow && ` ${entry.worstRow.leads} leads but only ${entry.worstRow.takenCalls} taken call${entry.worstRow.takenCalls !== 1 ? "s" : ""} (${fmtPct(entry.worstRow.takenCallRate)} rate).`}
                    {entry.worstRow?.deals && entry.worstRow.deals > 0
                      ? ` ${entry.worstRow.deals} deal${entry.worstRow.deals !== 1 ? "s" : ""} — monitor before cutting.`
                      : " No deals closed."}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {entry.timeframeDetails.map((d) => (
                      <TimeframePill key={d.label} detail={d} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {monitor.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-sm font-medium">Monitor — mixed signals</span>
            </div>
            <div className="space-y-1">
              {monitor.map((entry) => (
                <div key={entry.utm} className="flex items-center justify-between gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <span className="font-mono text-xs break-all text-foreground">{entry.utm}</span>
                  <div className="flex shrink-0 gap-1.5">
                    {entry.timeframeDetails.map((d) => (
                      <TimeframePill key={d.label} detail={d} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {scale.length === 0 && reduce.length === 0 && monitor.length === 0 && (
          <p className="text-sm text-muted-foreground">Not enough conversion data to generate recommendations. More taken calls are needed across ads.</p>
        )}
      </CardContent>
    </Card>
  )
}

function TimeframePill({ detail }: { detail: { label: string; category: string; leads: number; takenCalls: number; takenCallRate: number } }) {
  const colors: Record<string, string> = {
    winner: "bg-green-500/15 text-green-600 dark:text-green-400",
    sniper: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    fake: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    garbage: "bg-red-500/15 text-red-600 dark:text-red-400",
  }
  const shortLabel = detail.label.replace("Last ", "")
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colors[detail.category] ?? "bg-muted text-muted-foreground"}`}
      title={`${detail.label}: ${detail.leads} leads, ${detail.takenCalls} taken, ${fmtPct(detail.takenCallRate)} rate`}
    >
      {shortLabel}
    </span>
  )
}
