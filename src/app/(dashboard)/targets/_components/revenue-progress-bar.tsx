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
  /** Closed deal value (total contract value) - shown as a secondary reference
   *  since `current` is now the collected (actually-paid) figure. The Stripe
   *  cross-check compares against this, not against collected. */
  closed?: number
  /** Stripe-side cross-check value. When higher than closed deal value, the gap is surfaced as a yellow chip. */
  stripeCrossCheck?: number
  /** Click handler for the gap chip - host can open a drilldown listing the underlying Stripe invoices. */
  onGapClick?: () => void
}

// Sub-€100 differences are noise (rounding, single-line credits etc.) - don't flag.
const GAP_THRESHOLD = 100

export const RevenueProgressBar = memo(function RevenueProgressBar({
  current, proRata, monthlyTarget, isLoading, label = "Revenue (collected)",
  closed, stripeCrossCheck, onGapClick,
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

  const barColor = performance >= 1 ? "bg-green-500" : "bg-red-500"
  const textColor = performance >= 1 ? "text-green-500" : "text-red-500"

  // Surface a gap when Stripe shows more new business than Monday's closed deals -
  // means deals are invoiced but not yet logged in Monday. Compared against
  // closed deal value (not collected), since Stripe NB is contract-side. Click → drilldown.
  const gapBase = closed ?? current
  const gap = stripeCrossCheck != null ? stripeCrossCheck - gapBase : 0
  const showGapChip = gap > GAP_THRESHOLD

  return (
    <div className="bg-card rounded-lg p-4 border border-border/40 space-y-3">
      {/* Header: label + gap chip + actual / target */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          {showGapChip && (
            <button
              type="button"
              onClick={onGapClick}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium",
                "bg-yellow-500/15 text-yellow-500 hover:bg-yellow-500/25 transition-colors",
                onGapClick && "cursor-pointer",
              )}
              title="Stripe shows more New Business than Monday - click to see which invoices"
            >
              Stripe shows +{formatCurrency(gap)} not in Monday
            </button>
          )}
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-xl font-bold font-mono", textColor)}>{formatCurrency(current)}</span>
            <span className="text-xs text-muted-foreground/60 font-mono">of {formatCurrency(monthlyTarget)}</span>
          </div>
          {closed != null && (
            <span className="text-[10px] font-mono text-muted-foreground/60">
              closed {formatCurrency(closed)}
            </span>
          )}
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-4 bg-muted rounded-full overflow-visible">
        {/* Pro-rata expected - lighter background */}
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
