"use client"

import { memo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/targets/formatters"

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
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    )
  }

  const onTarget = invoicedTarget > 0 && invoiced >= invoicedTarget
  const nbShare = invoiced > 0 ? (newBusiness / invoiced) * 100 : 0
  const mrrShare = invoiced > 0 ? (mrr / invoiced) * 100 : 0

  const SEGMENTS = [
    { label: "New Business", value: newBusiness, className: "bg-[var(--teal)]" },
    { label: "MRR", value: mrr, className: "bg-[var(--teal)]/45" },
  ]

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

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">New Business</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{formatCurrency(newBusiness)}</p>
              <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/60">{nbShare.toFixed(0)}% of invoiced</p>
            </div>
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">MRR</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{formatCurrency(mrr)}</p>
              <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/60">{mrrShare.toFixed(0)}% of invoiced</p>
            </div>
          </div>
        </div>

        {/* ── Right: new business vs recurring split ── */}
        <div className="min-w-0">
          <div className="flex items-baseline justify-between mb-2">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60">New business vs recurring</p>
            <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
              {nbShare.toFixed(0)}% new · {mrrShare.toFixed(0)}% recurring
            </p>
          </div>
          <CompositionBar segments={SEGMENTS} />
          <div className="mt-4 grid grid-cols-2 gap-4">
            {SEGMENTS.map((s) => (
              <div key={s.label} className="flex items-start gap-2">
                <span className={cn("mt-1 h-2.5 w-2.5 rounded-sm shrink-0", s.className)} />
                <div className="min-w-0">
                  <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">{s.label}</p>
                  <p className="font-mono text-sm font-semibold tabular-nums">{formatCurrency(s.value)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
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
