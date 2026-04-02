"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { UtmRow, KpiResult } from "@/lib/clients/kpis"

type ScoredRow = UtmRow & {
  takenCallRate: number
  bookingRate: number
  dealRate: number
  reliability: "high" | "medium" | "low"
  category: "winner" | "sniper" | "fake" | "garbage"
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(0)}%`
}

function fmtEur(n: number) {
  return `€${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

function reliability(row: UtmRow): "high" | "medium" | "low" {
  if (row.leads >= 15 || row.takenCalls >= 5) return "high"
  if (row.leads >= 5 || row.takenCalls >= 2) return "medium"
  return "low"
}

export function scoreRows(rows: UtmRow[]): ScoredRow[] | null {
  const withLeads = rows.filter((r) => r.leads > 0)
  if (withLeads.length < 2) return null

  const medianLeads = median(withLeads.map((r) => r.leads))
  const takenCallRates = withLeads.map((r) => r.takenCalls / r.leads)
  const medianTakenCallRate = median(takenCallRates)

  return withLeads.map((row, i) => {
    const takenCallRate = takenCallRates[i]
    const bookingRate = row.bookedCalls / row.leads
    const dealRate = row.takenCalls > 0 ? row.deals / row.takenCalls : 0

    const highVolume = row.leads >= medianLeads
    const highQuality = takenCallRate >= medianTakenCallRate

    let category: ScoredRow["category"]
    if (highVolume && highQuality) category = "winner"
    else if (!highVolume && highQuality) category = "sniper"
    else if (highVolume && !highQuality) category = "fake"
    else category = "garbage"

    return { ...row, takenCallRate, bookingRate, dealRate, reliability: reliability(row), category }
  })
}

const CATEGORIES = [
  { key: "winner", label: "All-round winner", emoji: "🏆", border: "border-green-500/40", bg: "bg-green-500/5" },
  { key: "sniper", label: "Sniper", emoji: "🎯", border: "border-blue-500/40", bg: "bg-blue-500/5" },
  { key: "fake", label: "Fake winner", emoji: "⚠️", border: "border-amber-500/40", bg: "bg-amber-500/5" },
  { key: "garbage", label: "Garbage", emoji: "🗑️", border: "border-red-500/40", bg: "bg-red-500/5" },
] as const

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

function AdRow({ row }: { row: ScoredRow }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-background px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs leading-snug text-foreground break-all" title={row.utm}>
          {row.utm}
        </span>
        <ReliabilityBadge level={row.reliability} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        <span>{row.leads} leads</span>
        <span>{row.bookedCalls} booked</span>
        <span>{row.takenCalls} taken</span>
        {row.deals > 0 && <span>{row.deals} deals</span>}
        {row.revenue > 0 && <span>{fmtEur(row.revenue)}</span>}
        <span className="font-medium text-foreground">{fmtPct(row.takenCallRate)} taken rate</span>
        <span>{fmtPct(row.bookingRate)} booking rate</span>
      </div>
    </div>
  )
}

export function OptimizationProposal({ scored, kpis }: { scored: ScoredRow[]; kpis: KpiResult }) {
  const scale = scored.filter(
    (r) => (r.category === "winner" || r.category === "sniper") && r.takenCalls >= 1
  ).sort((a, b) => b.takenCalls - a.takenCalls)

  const reduce = scored.filter(
    (r) => (r.category === "fake" || r.category === "garbage") && r.leads >= 3
  ).sort((a, b) => b.leads - a.leads)

  const monitor = scored.filter(
    (r) =>
      (r.category === "winner" || r.category === "sniper") && r.takenCalls === 0 ||
      r.reliability === "low"
  )

  const hasRoi = kpis.roi > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Campaign Optimisation Proposal</CardTitle>
        <p className="text-xs text-muted-foreground">
          Based on taken call rate and booking rate per ad. Prioritises conversion quality over lead volume.
          {hasRoi && ` Overall account ROI: ${kpis.roi.toFixed(2)}x (€${kpis.revenue.toLocaleString("en-GB", { maximumFractionDigits: 0 })} revenue on €${kpis.adSpend.toLocaleString("en-GB", { maximumFractionDigits: 0 })} spend).`}
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
              {scale.map((r) => (
                <div key={r.utm} className="rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs break-all text-foreground">{r.utm}</span>
                    <ReliabilityBadge level={r.reliability} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.category === "winner"
                      ? `All-round performer — ${r.takenCalls} taken calls (${fmtPct(r.takenCallRate)} rate), ${r.leads} leads. ${
                          r.reliability === "low"
                            ? "Scale cautiously — limited data so far."
                            : "Strong across both volume and quality. Scale with confidence."
                        }`
                      : `Sniper — low opt-in volume but ${fmtPct(r.takenCallRate)} taken call rate. ${r.takenCalls} taken call${r.takenCalls !== 1 ? "s" : ""}. ${
                          r.reliability === "low"
                            ? "Promising early signal — scale modestly to gather more data before committing."
                            : "Reliable signal. Scale budget to capture more of this high-quality traffic."
                        }`}
                    {r.deals > 0 && ` ${r.deals} deal${r.deals !== 1 ? "s" : ""} closed${r.revenue > 0 ? ` (${fmtEur(r.revenue)})` : ""}.`}
                  </p>
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
              {reduce.map((r) => (
                <div key={r.utm} className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs break-all text-foreground">{r.utm}</span>
                    <ReliabilityBadge level={r.reliability} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.category === "fake"
                      ? `Fake winner — ${r.leads} opt-ins but only ${r.takenCalls} taken call${r.takenCalls !== 1 ? "s" : ""} (${fmtPct(r.takenCallRate)} rate). High volume of unqualified leads is inflating cost per taken call.`
                      : `Low performer — ${r.leads} leads, ${r.takenCalls} taken call${r.takenCalls !== 1 ? "s" : ""}. Neither volume nor quality justifies continued spend.`}
                    {r.deals > 0
                      ? ` ${r.deals} deal${r.deals !== 1 ? "s" : ""} closed — monitor before cutting entirely.`
                      : " No deals closed in this period."}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {monitor.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-sm font-medium">Monitor — insufficient data</span>
            </div>
            <div className="space-y-1">
              {monitor.map((r) => (
                <div key={r.utm} className="flex items-center justify-between gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <span className="font-mono text-xs break-all text-foreground">{r.utm}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.leads} leads · {r.takenCalls} taken</span>
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

type Props = {
  rows: UtmRow[]
  kpis: KpiResult
}

export function AdPerformance({ rows, kpis }: Props) {
  const scored = scoreRows(rows)

  if (!scored) {
    return null
  }

  const byCategory = (key: ScoredRow["category"]) =>
    scored.filter((r) => r.category === key).sort((a, b) => b.takenCalls - a.takenCalls || b.leads - a.leads)

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Ad Performance Analysis</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CATEGORIES.map(({ key, label, emoji, border, bg }) => {
          const ads = byCategory(key as ScoredRow["category"])
          return (
            <div key={key} className={`rounded-lg border ${border} ${bg} p-4`}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium">
                  {emoji} {label}
                </span>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium">
                  {ads.length}
                </span>
              </div>
              {ads.length === 0 ? (
                <p className="text-xs text-muted-foreground">No ads in this category.</p>
              ) : (
                <div className="space-y-2">
                  {ads.map((row) => (
                    <AdRow key={row.utm} row={row} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Categories are based on relative opt-in volume (proxy for cost per lead) and taken call rate (proxy for cost per call) compared to the median across all ads in this period. Reliability reflects data confidence based on lead and call volume.
      </p>
    </div>
  )
}
