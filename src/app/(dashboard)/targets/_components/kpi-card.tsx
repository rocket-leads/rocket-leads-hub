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
  variant: "cost" | "volume" | "neutral"
  isLoading: boolean
  error?: string | null
  onRetry?: () => void
}

function getColor(variant: string, value: number, target: number): string {
  if (variant === "volume") {
    const pct = safeDivide(value, target)
    if (pct >= 1) return "text-green-500"
    if (pct >= 0.7) return "text-primary"
    return "text-red-500"
  }
  if (variant === "cost") {
    const ratio = safeDivide(value, target)
    if (ratio <= 1) return "text-green-500"
    if (ratio <= 1.2) return "text-primary"
    return "text-red-500"
  }
  return ""
}

function getBarColor(variant: string, value: number, target: number): string {
  if (variant === "volume") {
    const pct = safeDivide(value, target)
    if (pct >= 1) return "bg-green-500"
    if (pct >= 0.7) return "bg-primary"
    return "bg-red-500"
  }
  const ratio = safeDivide(value, target)
  if (ratio <= 1) return "bg-green-500"
  if (ratio <= 1.2) return "bg-primary"
  return "bg-red-500"
}

export const KpiCard = memo(function KpiCard({
  label, value, formatted, target, targetFormatted, variant,
  isLoading, error, onRetry,
}: KpiCardProps) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg p-3 flex flex-col gap-2 border border-border/40">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-28" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-red-500/20 p-3 flex flex-col items-center justify-center gap-1.5 min-h-[80px]">
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

  return (
    <div className="bg-card rounded-lg p-3 flex flex-col gap-0.5 border border-border/40">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn(
        "text-xl font-bold font-mono leading-tight tracking-tight",
        colorClass || "text-foreground",
      )}>
        {formatted}
      </span>
      {hasTarget && (
        <div className="mt-1 space-y-0.5">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-700", getBarColor(variant, value!, target!))}
              style={{ width: `${barPct}%` }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground/60">
            {targetFormatted}
          </span>
        </div>
      )}
    </div>
  )
})
