"use client"

import { memo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowDown } from "lucide-react"
import { formatCurrencyDecimal } from "@/lib/targets/formatters"

interface Props {
  /** Optional — kept for backwards compat. Not displayed in the funnel. */
  leads?: number
  calls: number
  qualified: number
  taken: number
  deals: number
  /** Total ad spend over the period — used to compute cost per stage */
  adSpend?: number
  isLoading: boolean
}

interface Stage {
  label: string
  value: number
  /** Color class applied to the trapezoid background */
  color: string
  /** Tailwind text class */
  textColor: string
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
  calls, qualified, taken, deals, adSpend = 0, isLoading,
}: Props) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      </div>
    )
  }

  const stages: Stage[] = [
    { label: "Booked Calls", value: calls,     color: "bg-primary/30",  textColor: "text-primary" },
    { label: "Qualified",   value: qualified, color: "bg-primary/50",  textColor: "text-primary" },
    { label: "Taken Calls", value: taken,     color: "bg-primary/70",  textColor: "text-foreground" },
    { label: "Deals",       value: deals,     color: "bg-green-500/80", textColor: "text-green-400" },
  ]

  // Width of each stage trapezoid is relative to the top stage (booked calls)
  const top = Math.max(calls, 1)
  // Minimum width so even tiny stages are visible
  const widthFor = (val: number) => Math.max((val / top) * 100, 12)

  return (
    <div className="bg-card rounded-lg p-4 border border-border/40">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Sales Funnel</h3>

      <div className="space-y-1">
        {stages.map((stage, i) => {
          const width = widthFor(stage.value)
          const conversionFromPrev = i > 0 ? pct(stage.value, stages[i - 1].value) : null
          const cost = costPer(adSpend, stage.value)

          return (
            <div key={stage.label}>
              {/* Conversion arrow between stages */}
              {i > 0 && (
                <div className="flex items-center justify-center gap-1 py-1.5">
                  <ArrowDown className="h-3 w-3 text-muted-foreground/40" />
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {conversionFromPrev!.toFixed(0)}%
                  </span>
                </div>
              )}

              {/* Trapezoid stage */}
              <div className="relative h-16 flex items-center justify-center">
                <div
                  className={`absolute inset-y-0 ${stage.color} rounded-md transition-all duration-700 flex items-center justify-center`}
                  style={{
                    width: `${width}%`,
                    clipPath: i === stages.length - 1
                      ? "polygon(0 0, 100% 0, 100% 100%, 0 100%)"
                      : undefined,
                  }}
                >
                  <div className="text-center px-2">
                    <div className={`text-[9px] uppercase tracking-wider ${stage.textColor} opacity-80 leading-none`}>
                      {stage.label}
                    </div>
                    <div className="text-xl font-bold font-mono text-foreground leading-tight">
                      {stage.value.toLocaleString("en-GB")}
                    </div>
                    {adSpend > 0 && (
                      <div className="text-[9px] font-mono text-muted-foreground/70 leading-none mt-0.5">
                        {formatCurrencyDecimal(cost)} / {stage.label.split(" ")[0].toLowerCase()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {/* Overall funnel conversion */}
        {calls > 0 && (
          <div className="border-t border-border/40 mt-3 pt-3 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Overall conversion (Booked → Deal)</span>
            <span className="font-mono font-medium text-foreground">
              {pct(deals, calls).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
})
