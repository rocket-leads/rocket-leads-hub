"use client"

import { memo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/targets/formatters"
import { ShareDonut } from "./share-donut"

interface Props {
  invoiced: number
  newBusiness: number
  mrr: number
  invoicedTarget: number
  /** Month-end projection when viewing the current month-to-date - extrapolates
   *  the invoiced-so-far at the current daily pace to the full calendar month. */
  projection: { value: number; daysElapsed: number; daysInMonth: number } | null
  isLoading: boolean
}

const NB_COLOR = "#8967F3"
const MRR_COLOR = "#B7A6F5"

/** vs-target delta pill (higher is better). Inline white-space so it never wraps. */
function Delta({ current, target }: { current: number; target: number }) {
  if (!target) return null
  const pct = (current / target - 1) * 100
  if (!isFinite(pct)) return null
  const good = current >= target
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

export const FinanceHero = memo(function FinanceHero({ invoiced, newBusiness, mrr, invoicedTarget, projection, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="section-card">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-8">
          <div className="space-y-4">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-14 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="mx-auto h-40 w-40 rounded-full" />
        </div>
      </div>
    )
  }

  const onTarget = invoicedTarget > 0 && invoiced >= invoicedTarget

  const segments = [
    { name: "New Business", value: newBusiness, color: NB_COLOR },
    { name: "MRR", value: mrr, color: MRR_COLOR },
  ].filter((s) => s.value > 0)

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
            Service fee invoiced
          </p>
          <p className="mt-1 font-mono text-[54px] font-bold leading-none tracking-tight tabular-nums text-foreground">
            {formatCurrency(invoiced)}
          </p>
          <div className="mt-3 h-0.5 w-16 rounded-full bg-[var(--teal)]" />
          <p className="mt-3 text-[13px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground/80">{formatCurrency(newBusiness)}</span> new business ·{" "}
            <span className="font-medium text-foreground/80">{formatCurrency(mrr)}</span> recurring.
          </p>
          <Delta current={invoiced} target={invoicedTarget} />
        </div>

        {/* ── Right: new business vs recurring donut ── */}
        {segments.length > 0 ? (
          <ShareDonut segments={segments} centerLabel="Invoiced" />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No invoiced revenue this period</div>
        )}
      </div>

      {projection && (
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border/40 pt-4">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60">Projected month-end</span>
            <span className="font-mono text-[22px] font-bold tabular-nums text-foreground">{formatCurrency(projection.value)}</span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground/60">
            Day {projection.daysElapsed} of {projection.daysInMonth} · {formatCurrency(invoiced)} invoiced so far, at current pace
          </span>
        </div>
      )}
    </div>
  )
})
