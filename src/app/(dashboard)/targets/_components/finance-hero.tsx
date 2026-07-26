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
  /** Pace-adjusted expected values (monthly target × fraction of month elapsed).
   *  We're mid-month, so status is measured against where each stream should be
   *  by now, not the full end-of-month target. */
  invoicedExpected: number
  mrrExpected: number
  newBusinessExpected: number
  /** Month-end projection when viewing the current month-to-date. */
  projection: { value: number; daysElapsed: number; daysInMonth: number } | null
  isLoading: boolean
}

const MRR_COLOR = "#8967F3"
const NB_COLOR = "#B7A6F5"

/** Per-stream pace status: is this stream ahead of / behind where it should be
 *  by this day of the month? Green = on/ahead of pace, red = behind. */
function PaceChip({ label, current, expected }: { label: string; current: number; expected: number }) {
  if (expected <= 0) return null
  const good = current >= expected
  const pct = Math.abs((current / expected - 1) * 100)
  return (
    <span
      className={cn("delta", good ? "up" : "down")}
      style={{ marginTop: 0, whiteSpace: "nowrap", width: "max-content", maxWidth: "100%" }}
    >
      <span className="d-dot" />
      {label} {good ? "▲" : "▼"} {pct.toFixed(0)}%
    </span>
  )
}

export const FinanceHero = memo(function FinanceHero({
  invoiced, newBusiness, mrr, invoicedExpected, mrrExpected, newBusinessExpected, projection, isLoading,
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
          <Skeleton className="mx-auto h-40 w-40 rounded-full" />
        </div>
      </div>
    )
  }

  const onTrack = invoicedExpected > 0 && invoiced >= invoicedExpected
  const hasPace = mrrExpected > 0 || newBusinessExpected > 0

  const segments = [
    { name: "MRR", value: mrr, color: MRR_COLOR },
    { name: "New Business", value: newBusiness, color: NB_COLOR },
  ].filter((s) => s.value > 0)

  return (
    <div className="section-card overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-8 items-center">
        {/* ── Left: headline ── */}
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70 flex items-center gap-2.5">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", onTrack ? "bg-[var(--st-live)]" : "bg-[var(--st-warn)]")} />
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
            <span className="font-medium text-foreground/80">{formatCurrency(mrr)}</span> recurring ·{" "}
            <span className="font-medium text-foreground/80">{formatCurrency(newBusiness)}</span> new business.
          </p>

          {/* Per-stream pace status - which of the two is on/off track */}
          {hasPace && (
            <div className="mt-4">
              <p className="mb-1.5 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/50">vs expected pace</p>
              <div className="flex flex-wrap gap-2">
                <PaceChip label="MRR" current={mrr} expected={mrrExpected} />
                <PaceChip label="New Business" current={newBusiness} expected={newBusinessExpected} />
              </div>
            </div>
          )}
        </div>

        {/* ── Right: MRR vs New Business donut ── */}
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
