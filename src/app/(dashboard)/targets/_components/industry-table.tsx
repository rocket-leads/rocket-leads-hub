"use client"

import { memo } from "react"
import type { IndustryData } from "@/types/targets"
import { formatCurrency } from "@/lib/targets/formatters"
import { Skeleton } from "@/components/ui/skeleton"

interface Props {
  data: IndustryData[]
  isLoading: boolean
}

export const IndustryTable = memo(function IndustryTable({ data, isLoading }: Props) {
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

  const rows = data.slice(0, 8)
  const totalDeals = rows.reduce((s, r) => s + r.deals, 0)
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const avgDealSize = totalDeals > 0 ? totalRevenue / totalDeals : 0

  return (
    <div className="bg-card rounded-lg p-4 border border-border/40">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Deals by Industry</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No deal data</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                <th className="text-left font-medium pb-2">Industry</th>
                <th className="text-right font-medium pb-2">Deals</th>
                <th className="text-right font-medium pb-2">Total</th>
                <th className="text-right font-medium pb-2">Avg / Deal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const avg = row.deals > 0 ? row.revenue / row.deals : 0
                return (
                  <tr key={row.industry} className="border-b border-border/20 last:border-0">
                    <td className="py-1.5 text-muted-foreground truncate max-w-[160px]">{row.industry}</td>
                    <td className="py-1.5 text-right font-mono text-foreground">{row.deals}</td>
                    <td className="py-1.5 text-right font-mono text-foreground">{formatCurrency(row.revenue)}</td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">{formatCurrency(avg)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border/40 text-[11px]">
                <td className="pt-2 font-medium uppercase tracking-wider text-muted-foreground/60 text-[10px]">Total</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{totalDeals}</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{formatCurrency(totalRevenue)}</td>
                <td className="pt-2 text-right font-mono font-bold text-foreground">{formatCurrency(avgDealSize)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
})
