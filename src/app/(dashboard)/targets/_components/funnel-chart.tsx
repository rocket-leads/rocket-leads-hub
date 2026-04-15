"use client"

import { memo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowDown, TrendingDown } from "lucide-react"
import { formatCurrency, formatCurrencyDecimal } from "@/lib/targets/formatters"
import { cn } from "@/lib/utils"

interface Props {
  leads?: number
  calls: number
  qualified: number
  taken: number
  deals: number
  revenue: number
  adSpend?: number
  isLoading: boolean
}

function pct(num: number, denom: number): number {
  if (denom <= 0) return 0
  return (num / denom) * 100
}

function costPer(spend: number, count: number): number {
  if (count <= 0) return 0
  return spend / count
}

export const FunnelChart = memo(function FunnelChart({
  calls, qualified, taken, deals, revenue, adSpend = 0, isLoading,
}: Props) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg p-5 border border-border/40">
        <Skeleton className="h-5 w-40 mb-6" />
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      </div>
    )
  }

  const stages = [
    { label: "Booked Calls", shortLabel: "CBC", value: calls, color: "bg-muted-foreground/20" },
    { label: "Qualified Calls", shortLabel: "CQC", value: qualified, color: "bg-muted-foreground/30" },
    { label: "Taken Calls", shortLabel: "CTC", value: taken, color: "bg-muted-foreground/40" },
    { label: "Deals", shortLabel: "CPD", value: deals, color: "bg-green-500/30" },
  ]

  const top = Math.max(calls, 1)
  const widthFor = (val: number) => Math.max((val / top) * 100, 20)

  return (
    <div className="bg-card rounded-lg p-5 border border-border/40">
      {/* Header with ad spend */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-medium text-foreground uppercase tracking-wider">Sales Funnel</h3>
        {adSpend > 0 && (
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Ad Spend</span>
            <span className="text-lg font-bold font-mono text-foreground">{formatCurrencyDecimal(adSpend)}</span>
          </div>
        )}
      </div>

      <div className="space-y-0">
        {stages.map((stage, i) => {
          const width = widthFor(stage.value)
          const convFromPrev = i > 0 ? pct(stage.value, stages[i - 1].value) : null
          const dropFromPrev = i > 0 ? stages[i - 1].value - stage.value : 0
          const cost = adSpend > 0 ? costPer(adSpend, stage.value) : null

          return (
            <div key={stage.label}>
              {/* Conversion arrow between stages */}
              {i > 0 && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <ArrowDown className="h-3.5 w-3.5 text-muted-foreground/40" />
                  <span className="text-xs font-mono font-medium text-foreground">
                    {convFromPrev!.toFixed(0)}%
                  </span>
                  {dropFromPrev > 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground/50 flex items-center gap-0.5">
                      <TrendingDown className="h-2.5 w-2.5" />
                      -{dropFromPrev}
                    </span>
                  )}
                </div>
              )}

              {/* Stage bar */}
              <div className="relative flex items-center justify-center mx-auto" style={{ width: `${width}%` }}>
                <div className={cn("w-full rounded-lg py-4 px-4", stage.color)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none mb-1">
                        {stage.label}
                      </div>
                      <div className="text-2xl font-bold font-mono text-foreground leading-none">
                        {stage.value.toLocaleString("en-GB")}
                      </div>
                    </div>
                    {cost != null && (
                      <div className="text-right">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 leading-none mb-0.5">
                          {stage.shortLabel}
                        </div>
                        <div className="text-sm font-mono font-medium text-foreground">
                          {formatCurrencyDecimal(cost)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom stats */}
      <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-border/40">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Revenue</span>
          <span className="text-lg font-bold font-mono text-foreground">{formatCurrency(revenue)}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Booked → Deal</span>
          <span className="text-lg font-bold font-mono text-foreground">{pct(deals, calls).toFixed(1)}%</span>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">ROAS</span>
          <span className="text-lg font-bold font-mono text-foreground">
            {adSpend > 0 ? `${(revenue / adSpend).toFixed(1)}×` : "—"}
          </span>
        </div>
      </div>
    </div>
  )
})
