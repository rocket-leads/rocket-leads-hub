"use client"

import { memo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"

interface Props {
  mrr: number
  newBusiness: number
  serviceFeeRevenue: number
  adBudget: number
  totalRevenue: number
  serviceFeePerCustomer: number
  churnRate: number
  customers: number
  mrrTarget: number
  newBusinessTarget: number
  serviceFeePerCustomerTarget: number
  maxChurnRate: number
  isLoading: boolean
}

/** vs-target delta pill. `lowerIsBetter` flips the good/bad colour for churn. */
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

export const DeliveryHero = memo(function DeliveryHero({
  mrr, newBusiness, serviceFeeRevenue, adBudget, totalRevenue, serviceFeePerCustomer, churnRate, customers,
  mrrTarget, newBusinessTarget, serviceFeePerCustomerTarget, maxChurnRate, isLoading,
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

  const onTarget = mrrTarget > 0 && mrr >= mrrTarget

  const MIX = [
    { label: "MRR", value: mrr, className: "bg-[var(--teal)]" },
    { label: "New Business", value: newBusiness, className: "bg-[var(--teal)]/55" },
    { label: "Ad Budget", value: adBudget, className: "bg-muted-foreground/30" },
  ]

  return (
    <div className="section-card overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-8 items-center">
        {/* ── Left: headline ── */}
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70 flex items-center gap-2.5">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", onTarget ? "bg-[var(--st-live)]" : "bg-[var(--st-warn)]")} />
            Delivery
          </p>
          <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
            Monthly recurring revenue
          </p>
          <p className="mt-1 font-mono text-[54px] font-bold leading-none tracking-tight tabular-nums text-foreground">
            {formatCurrency(mrr)}
          </p>
          <div className="mt-3 h-0.5 w-16 rounded-full bg-[var(--teal)]" />
          <p className="mt-3 text-[13px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground/80">{customers}</span> customer{customers === 1 ? "" : "s"} ·{" "}
            <span className="font-medium text-foreground/80">{formatCurrency(serviceFeePerCustomer)}</span> service fee / customer.
          </p>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">New Business</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{formatCurrency(newBusiness)}</p>
              <Delta current={newBusiness} target={newBusinessTarget} />
            </div>
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Total Revenue</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{formatCurrency(totalRevenue)}</p>
            </div>
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Churn Rate</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{formatPercent(churnRate)}</p>
              <Delta current={churnRate} target={maxChurnRate} lowerIsBetter />
            </div>
          </div>
        </div>

        {/* ── Right: revenue mix ── */}
        <div className="min-w-0">
          <div className="flex items-baseline justify-between mb-2">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60">Revenue mix</p>
            <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
              Service fee {formatCurrency(serviceFeeRevenue)}
            </p>
          </div>
          <CompositionBar segments={MIX} />
          <div className="mt-4 grid grid-cols-3 gap-3">
            {MIX.map((s) => (
              <div key={s.label} className="flex items-start gap-2">
                <span className={cn("mt-1 h-2.5 w-2.5 rounded-sm shrink-0", s.className)} />
                <div className="min-w-0">
                  <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60 truncate">{s.label}</p>
                  <p className="font-mono text-sm font-semibold tabular-nums">{formatCurrency(s.value)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})
