"use client"

import { memo, useEffect, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/targets/formatters"

interface Props {
  current: number
  proRata: number
  monthlyTarget: number
  isLoading: boolean
}

export const RevenueProgressBar = memo(function RevenueProgressBar({
  current, proRata, monthlyTarget, isLoading,
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
      <div className="bg-card rounded-lg p-3 border border-border/40">
        <Skeleton className="h-3 w-full rounded-full" />
      </div>
    )
  }

  const pct = monthlyTarget > 0 ? (current / monthlyTarget) * 100 : 0
  const proRataPct = monthlyTarget > 0 ? (proRata / monthlyTarget) * 100 : 0
  const performance = proRata > 0 ? current / proRata : 0

  const barColor =
    performance >= 1 ? "from-green-500/80 to-green-500" :
    performance >= 0.8 ? "from-primary/80 to-primary" :
    "from-red-500/80 to-red-500"

  return (
    <div className="bg-card rounded-lg p-3 border border-border/40">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">Revenue</span>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold font-mono text-foreground">{formatCurrency(current)}</span>
          <span className="text-xs text-muted-foreground/60 font-mono">/ {formatCurrency(monthlyTarget)}</span>
        </div>
      </div>
      <div className="relative h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${barColor} transition-all duration-1000 ease-out`}
          style={{ width: animated ? `${Math.min(pct, 100)}%` : "0%" }}
        />
        {proRataPct > 0 && proRataPct < 100 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-muted-foreground/50"
            style={{ left: `${proRataPct}%` }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-muted-foreground/60">€0</span>
        <span className="text-[9px] text-muted-foreground/60 font-mono">{Math.round(performance * 100)}% of expected</span>
        <span className="text-[9px] text-muted-foreground/60">{formatCurrency(monthlyTarget)}</span>
      </div>
    </div>
  )
})
