"use client"

import { memo } from "react"
import type { CloserData } from "@/types/targets"
import { formatCurrency, formatPercent, safeDivide } from "@/lib/targets/formatters"
import { Skeleton } from "@/components/ui/skeleton"

interface Props {
  data: CloserData[]
  isLoading: boolean
}

export const ClosersTable = memo(function ClosersTable({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <Skeleton className="h-4 w-40 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      </div>
    )
  }

  // Show-up rate denominator: only past calls that have been processed (qualified − notUpdated).
  const showUpDenom = (row: CloserData) => Math.max(0, row.qualifiedCalls - row.notUpdated)

  const totalQualified = data.reduce((s, r) => s + r.qualifiedCalls, 0)
  const totalUpcoming = data.reduce((s, r) => s + r.upcomingCalls, 0)
  const totalTaken = data.reduce((s, r) => s + r.takenCalls, 0)
  const totalNotUpdated = data.reduce((s, r) => s + r.notUpdated, 0)
  const totalDeals = data.reduce((s, r) => s + r.deals, 0)
  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0)
  const totalShowUpDenom = data.reduce((s, r) => s + showUpDenom(r), 0)
  const totalShowUp = safeDivide(totalTaken, totalShowUpDenom)
  const totalConv = safeDivide(totalDeals, totalTaken)
  const totalAvg = safeDivide(totalRevenue, totalDeals)

  return (
    <div className="bg-card rounded-lg p-4 border border-border/40">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Performance by Closer</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No closer data</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                <th className="text-left font-medium pb-2">Closer</th>
                <th className="text-right font-medium pb-2" title="Past appointments scheduled with this closer (all statuses)">Qualified</th>
                <th className="text-right font-medium pb-2">Taken</th>
                <th className="text-right font-medium pb-2" title="Taken ÷ (Qualified − Not Updated) — only counts processed past calls">Show-up</th>
                <th className="text-right font-medium pb-2" title="Past appointments still in Qualified / Gepland status — closer hasn't updated">Not Updated</th>
                <th className="text-right font-medium pb-2" title="Future appointments scheduled in the period — pending workload">Upcoming</th>
                <th className="text-right font-medium pb-2">Deals</th>
                <th className="text-right font-medium pb-2">Conv</th>
                <th className="text-right font-medium pb-2">Total</th>
                <th className="text-right font-medium pb-2">Avg / Deal</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const denom = showUpDenom(row)
                const showUp = safeDivide(row.takenCalls, denom)
                const conv = safeDivide(row.deals, row.takenCalls)
                const avg = safeDivide(row.revenue, row.deals)
                const isUnassigned = row.closer === "Unassigned"
                return (
                  <tr key={row.closer} className="border-b border-border/20 last:border-0">
                    <td className={`py-1.5 truncate max-w-[140px] ${isUnassigned ? "text-muted-foreground/60 italic" : "text-muted-foreground"}`}>{row.closer}</td>
                    <td className="py-1.5 text-right font-mono text-foreground">{row.qualifiedCalls}</td>
                    <td className="py-1.5 text-right font-mono text-foreground">{row.takenCalls}</td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">{denom > 0 ? formatPercent(showUp) : "—"}</td>
                    <td className={`py-1.5 text-right font-mono ${row.notUpdated > 0 ? "text-yellow-500" : "text-muted-foreground/40"}`}>{row.notUpdated > 0 ? row.notUpdated : "—"}</td>
                    <td className={`py-1.5 text-right font-mono ${row.upcomingCalls > 0 ? "text-foreground" : "text-muted-foreground/40"}`}>{row.upcomingCalls > 0 ? row.upcomingCalls : "—"}</td>
                    <td className="py-1.5 text-right font-mono text-foreground">{row.deals}</td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">{row.takenCalls > 0 ? formatPercent(conv) : "—"}</td>
                    <td className="py-1.5 text-right font-mono text-foreground">{formatCurrency(row.revenue)}</td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">{row.deals > 0 ? formatCurrency(avg) : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border/40 text-[11px]">
                <td className="pt-2 font-medium uppercase tracking-wider text-muted-foreground/60 text-[10px]">Total</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{totalQualified}</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{totalTaken}</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{totalShowUpDenom > 0 ? formatPercent(totalShowUp) : "—"}</td>
                <td className={`pt-2 text-right font-mono font-bold ${totalNotUpdated > 0 ? "text-yellow-500" : "text-muted-foreground/40"}`}>{totalNotUpdated > 0 ? totalNotUpdated : "—"}</td>
                <td className={`pt-2 text-right font-mono font-bold ${totalUpcoming > 0 ? "text-foreground" : "text-muted-foreground/40"}`}>{totalUpcoming > 0 ? totalUpcoming : "—"}</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{totalDeals}</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{totalTaken > 0 ? formatPercent(totalConv) : "—"}</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{formatCurrency(totalRevenue)}</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{totalDeals > 0 ? formatCurrency(totalAvg) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
})
