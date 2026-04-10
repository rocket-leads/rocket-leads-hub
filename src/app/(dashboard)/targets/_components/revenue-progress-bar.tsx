"use client"

import { memo, useEffect, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/targets/formatters"
import { cn } from "@/lib/utils"

interface Props {
  current: number
  proRata: number
  monthlyTarget: number
  isLoading: boolean
  label?: string
}

export const RevenueProgressBar = memo(function RevenueProgressBar({
  current, proRata, monthlyTarget, isLoading, label = "Revenue",
}: Props) {
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    if (!isLoading) {
      const t = setTimeout(() => setAnimated(true), 100)
      return () => clearTimeout(t)
    }
    setAnimated(false)
  }, [isLoading, current])

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <Skeleton className="h-3 w-full rounded-full" />
      </div>
    )
  }

  const pct = monthlyTarget > 0 ? (current / monthlyTarget) * 100 : 0
  const proRataPct = monthlyTarget > 0 ? (proRata / monthlyTarget) * 100 : 0
  const performance = proRata > 0 ? current / proRata : 0

  const barColor =
    performance >= 1 ? "bg-green-500" :
    performance >= 0.8 ? "bg-primary" :
    "bg-red-500"

  const textColor =
    performance >= 1 ? "text-green-500" :
    performance >= 0.8 ? "text-primary" :
    "text-red-500"

  return (
    <div className="bg-card rounded-lg p-4 border border-border/40 space-y-3">
      {/* Header: label + actual / target */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="flex items-baseline gap-2">
          <span className={cn("text-xl font-bold font-mono", textColor)}>{formatCurrency(current)}</span>
          <span className="text-xs text-muted-foreground/60 font-mono">of {formatCurrency(monthlyTarget)}</span>
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-4 bg-muted rounded-full overflow-visible">
        {/* Pro-rata expected — lighter background */}
        {proRataPct > 0 && (
          <div
            className="absolute inset-y-0 left-0 bg-muted-foreground/20 rounded-full"
            style={{ width: `${Math.min(proRataPct, 100)}%` }}
          />
        )}
        {/* Actual progress */}
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out", barColor)}
          style={{ width: animated ? `${Math.min(pct, 100)}%` : "0%" }}
        />
        {/* Expected marker line */}
        {proRataPct > 0 && proRataPct < 100 && (
          <div
            className="absolute -top-1 -bottom-1 w-px bg-foreground/40"
            style={{ left: `${proRataPct}%` }}
          />
        )}
      </div>

      {/* Three-column legend */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", barColor)} />
          <div className="flex flex-col leading-tight">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Actual</span>
            <span className={cn("text-xs font-mono font-medium", textColor)}>{formatCurrency(current)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 justify-center">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
          <div className="flex flex-col leading-tight">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Expected</span>
            <span className="text-xs font-mono font-medium text-foreground">{formatCurrency(proRata)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 justify-end">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/20 border border-border" />
          <div className="flex flex-col leading-tight">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Target</span>
            <span className="text-xs font-mono font-medium text-foreground">{formatCurrency(monthlyTarget)}</span>
          </div>
        </div>
      </div>

      {/* Performance line */}
      {proRata > 0 && (
        <div className="text-[10px] text-muted-foreground text-center pt-1 border-t border-border/30">
          <span className={cn("font-mono font-medium", textColor)}>{Math.round(performance * 100)}%</span> of expected pace
        </div>
      )}
    </div>
  )
})
