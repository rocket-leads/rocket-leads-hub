"use client"

import { memo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"

interface Props {
  revenue: number
  totalCosts: number
  netProfit: number
  margin: number
  marginTarget: number
  netProfitTarget: number
  maxTotalCostsTarget: number
  isEstimated: boolean
  isLoading: boolean
}

/** Small vs-target delta pill. `lowerIsBetter` flips the good/bad colour for
 *  cost-style metrics. Inline white-space so it never wraps in a tight column. */
function Delta({ current, target, lowerIsBetter = false }: { current: number; target: number; lowerIsBetter?: boolean }) {
  if (!target) return null
  const pct = (current / target - 1) * 100
  if (!isFinite(pct)) return null
  const good = lowerIsBetter ? current <= target : current >= target
  return (
    <span
      className={cn("delta", good ? "up" : "down")}
      style={{ marginTop: 8, whiteSpace: "nowrap", width: "max-content", maxWidth: "100%" }}
    >
      <span className="d-dot" />
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs target
    </span>
  )
}

/** Horizontal composition bar - segments sized by their share of the total. */
function CompositionBar({ segments }: { segments: Array<{ label: string; value: number; className: string }> }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      {segments.map((s) => (
        <div
          key={s.label}
          className={cn("h-full", s.className)}
          style={{ width: `${(Math.max(0, s.value) / total) * 100}%` }}
          title={`${s.label}: ${formatCurrency(s.value)}`}
        />
      ))}
    </div>
  )
}

export const FinanceHero = memo(function FinanceHero({
  revenue, totalCosts, netProfit, margin, marginTarget, netProfitTarget, maxTotalCostsTarget, isEstimated, isLoading,
}: Props) {
  if (isLoading) {
    return (
      <div className="section-card">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-8">
          <div className="space-y-4">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-14 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    )
  }

  const onTarget = marginTarget > 0 && margin >= marginTarget
  const isLoss = netProfit < 0
  const profitShare = revenue > 0 ? Math.max(0, netProfit) / revenue : 0

  return (
    <div className="section-card overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-8 items-center">
        {/* ── Left: headline ── */}
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70 flex items-center gap-2.5">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", onTarget ? "bg-[var(--st-live)]" : "bg-[var(--st-warn)]")} />
            Financials
          </p>
          <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
            Net profit margin{isEstimated && <span className="ml-1.5 text-[var(--st-warn)]">· est</span>}
          </p>
          <p className={cn("mt-1 font-mono text-[54px] font-bold leading-none tracking-tight tabular-nums", isLoss ? "text-[var(--st-error)]" : "text-foreground")}>
            {formatPercent(margin)}
          </p>
          <div className="mt-3 h-0.5 w-16 rounded-full bg-[var(--teal)]" />
          <p className="mt-3 text-[13px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground/80">{formatCurrency(netProfit)}</span> profit on{" "}
            <span className="font-medium text-foreground/80">{formatCurrency(revenue)}</span> revenue.
            {marginTarget > 0 && <> Target {formatPercent(marginTarget)}.</>}
          </p>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Revenue</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{formatCurrency(revenue)}</p>
            </div>
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Total Costs</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{formatCurrency(totalCosts)}</p>
              <Delta current={totalCosts} target={maxTotalCostsTarget} lowerIsBetter />
            </div>
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Net Profit</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{formatCurrency(netProfit)}</p>
              <Delta current={netProfit} target={netProfitTarget} />
            </div>
          </div>
        </div>

        {/* ── Right: revenue → costs / profit split ── */}
        <div className="min-w-0">
          <div className="flex items-baseline justify-between mb-2">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60">Where revenue goes</p>
            <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
              {isLoss ? "Operating at a loss" : `${(profitShare * 100).toFixed(0)}% kept as profit`}
            </p>
          </div>
          <CompositionBar
            segments={[
              { label: "Total Costs", value: totalCosts, className: "bg-muted-foreground/30" },
              { label: "Net Profit", value: Math.max(0, netProfit), className: "bg-[var(--teal)]" },
            ]}
          />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 rounded-sm bg-muted-foreground/30 shrink-0" />
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Total Costs</p>
                <p className="font-mono text-sm font-semibold tabular-nums">{formatCurrency(totalCosts)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 rounded-sm bg-[var(--teal)] shrink-0" />
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Net Profit</p>
                <p className={cn("font-mono text-sm font-semibold tabular-nums", isLoss && "text-[var(--st-error)]")}>{formatCurrency(netProfit)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
