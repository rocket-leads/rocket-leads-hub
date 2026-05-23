"use client"

import { memo } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { safeDivide } from "@/lib/targets/formatters"

interface KpiCardProps {
  label: string
  value: number | null
  formatted: string
  target?: number
  targetFormatted?: string
  /** Optional pro-rata expected value at this point in time. Renders a lighter background bar. */
  expected?: number
  /** Formatted expected value to display alongside the target label */
  expectedFormatted?: string
  /** When true, marks the value as estimated (computed from historical data, not actual) */
  isEstimated?: boolean
  /** Optional small yellow chip in the top-right (e.g. "+7 not updated") */
  notice?: string
  /** Tooltip text shown on hover of the notice chip */
  noticeTitle?: string
  /** True when the value shown is from the MTD placeholder, not the user's
   *  actual selected range. UI surfaces a small "MTD" pill + tones the value
   *  to muted so the user can tell it's a placeholder. */
  isMtdPlaceholder?: boolean
  variant: "cost" | "volume" | "neutral"
  isLoading: boolean
  error?: string | null
  onRetry?: () => void
}

function getColor(variant: string, value: number, target: number): string {
  if (variant === "volume") {
    const pct = safeDivide(value, target)
    return pct >= 1 ? "text-green-500" : "text-red-500"
  }
  if (variant === "cost") {
    const ratio = safeDivide(value, target)
    return ratio <= 1 ? "text-green-500" : "text-red-500"
  }
  return ""
}

function getBarColor(variant: string, value: number, target: number): string {
  if (variant === "volume") {
    const pct = safeDivide(value, target)
    return pct >= 1 ? "bg-green-500" : "bg-red-500"
  }
  const ratio = safeDivide(value, target)
  return ratio <= 1 ? "bg-green-500" : "bg-red-500"
}

// Chrome (rounded-2xl, border-border/60, shadow, px-5 py-4, 11px uppercase
// label, 26px font-heading value) is aligned 1:1 with the canonical KpiTile
// primitive — Roy 2026-05-23: "structuur en fonts moeten overal hetzelfde".
// What this card adds on top of KpiTile and what KpiTile doesn't:
//   - a target progress bar (actual + expected/pro-rata overlay)
//   - dashed border + "Expected" chip when value is computed (not yet actual)
//   - amber "notice" chip in top-right (e.g. "+7 not updated")
//   - variant-aware tone (cost: lower=good; volume: higher=good)
// Because of those extra features it stays its own component instead of
// being a wrapper around KpiTile.
export const KpiCard = memo(function KpiCard({
  label, value, formatted, target, targetFormatted, expected, expectedFormatted, isEstimated, notice, noticeTitle, isMtdPlaceholder, variant,
  isLoading, error, onRetry,
}: KpiCardProps) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl border border-border/60 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] px-5 py-4 flex flex-col gap-3 h-full">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-28" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-card rounded-2xl border border-red-500/20 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] px-5 py-4 flex flex-col items-center justify-center gap-1.5 h-full">
        <AlertCircle className="w-4 h-4 text-red-500" />
        {onRetry && (
          <button onClick={onRetry} className="text-[10px] text-primary hover:underline flex items-center gap-1">
            <RefreshCw className="w-2.5 h-2.5" />
            Retry
          </button>
        )}
      </div>
    )
  }

  const hasTarget = target != null && target > 0 && value != null
  const colorClass = hasTarget ? getColor(variant, value!, target!) : ""
  const barPct = hasTarget ? Math.min(safeDivide(value!, target!) * 100, 100) : 0
  const expectedPct = hasTarget && expected != null && expected > 0
    ? Math.min(safeDivide(expected, target!) * 100, 100)
    : 0

  return (
    <div className={cn(
      "bg-card rounded-2xl shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] px-5 py-4 flex flex-col h-full",
      isEstimated
        ? "border border-dashed border-primary/50"
        : "border border-border/60",
    )}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">
          {label}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {isMtdPlaceholder && (
            <span
              title="Showing MTD numbers while your selected range loads"
              className="text-[8px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 animate-pulse"
            >
              MTD
            </span>
          )}
          {notice && (
            <span
              title={noticeTitle}
              className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-500 whitespace-nowrap"
            >
              {notice}
            </span>
          )}
          {isEstimated && (
            <span className="text-[8px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
              Expected
            </span>
          )}
        </div>
      </div>
      {/* MTD placeholder used to dim the value to text-muted-foreground/60
          but Roy 2026-05-23: "die moeten wel zwart" — the small MTD pill in
          the top-right is enough signal on its own, the headline number
          should stay in the brand foreground so the page doesn't read as
          a sea of grey while the real range loads. */}
      <p className={cn(
        "font-heading text-[26px] font-bold tracking-tight tabular-nums leading-none transition-colors",
        colorClass || "text-foreground",
      )}>
        {formatted}
      </p>
      <div className="mt-auto" />
      {hasTarget && (
        <div className="mt-3 space-y-1">
          <div className="relative h-1 bg-muted rounded-full overflow-hidden">
            {/* Expected (pro-rata) — lighter background */}
            {expectedPct > 0 && (
              <div
                className="absolute inset-y-0 left-0 bg-muted-foreground/30 rounded-full"
                style={{ width: `${expectedPct}%` }}
              />
            )}
            {/* Actual progress */}
            <div
              className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-700", getBarColor(variant, value!, target!))}
              style={{ width: `${barPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground/70">{targetFormatted}</span>
            {expectedFormatted && (
              <span className="text-[11px] text-muted-foreground/70">expected {expectedFormatted}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
