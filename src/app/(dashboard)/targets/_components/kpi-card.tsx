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

export const KpiCard = memo(function KpiCard({
  label, value, formatted, target, targetFormatted, expected, expectedFormatted, isEstimated, variant,
  isLoading, error, onRetry,
}: KpiCardProps) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg p-3 flex flex-col gap-2 border border-border/40 h-full">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-28" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-red-500/20 p-3 flex flex-col items-center justify-center gap-1.5 h-full">
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
      "bg-card rounded-lg p-3 flex flex-col h-full",
      isEstimated
        ? "border border-dashed border-primary/50"
        : "border border-border/40",
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {isEstimated && (
          <span className="text-[8px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
            Expected
          </span>
        )}
      </div>
      <span className={cn(
        "text-xl font-bold font-mono leading-tight tracking-tight mt-0.5",
        colorClass || "text-foreground",
      )}>
        {formatted}
      </span>
      <div className="mt-auto" />
      {hasTarget && (
        <div className="mt-1 space-y-0.5">
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
            <span className="text-[9px] text-muted-foreground/60">{targetFormatted}</span>
            {expectedFormatted && (
              <span className="text-[9px] text-muted-foreground/60">expected {expectedFormatted}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
})
