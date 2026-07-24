"use client"

import { memo } from "react"
import { startOfMonth, differenceInDays, getDaysInMonth, max as dateMax } from "date-fns"
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot,
} from "recharts"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatCurrency, formatCurrencyDecimal, formatMultiplier, safeDivide } from "@/lib/targets/formatters"
import { deriveTargets } from "@/lib/targets/calculations"
import type { MondayTargetsData, MetaTargetsData, TargetsConfig, DateRange } from "@/types/targets"

interface Props {
  monday: MondayTargetsData | null
  meta: MetaTargetsData | null
  targets: TargetsConfig | null
  range: DateRange
  isLoading: boolean
}

/** Pro-rata a monthly target to where we should be in the current range. */
function proRata(monthlyTarget: number, range: DateRange): number {
  if (monthlyTarget <= 0) return 0
  const refMonthStart = startOfMonth(range.endDate)
  const effectiveStart = dateMax([range.startDate, refMonthStart])
  const days = differenceInDays(range.endDate, effectiveStart) + 1
  const daysInMonth = getDaysInMonth(range.endDate)
  return (monthlyTarget * days) / daysInMonth
}

function weekLabel(weekStart: string): string {
  return new Date(weekStart).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/** Small vs-target delta pill (dot + %). Volume/revenue: higher is better. */
function TargetDelta({ current, target }: { current: number; target: number }) {
  if (target <= 0) return null
  const pct = (current / target - 1) * 100
  if (!isFinite(pct)) return null
  const up = pct >= 0
  return (
    <span className={cn("delta", up ? "up" : "down")} style={{ marginTop: 8 }}>
      <span className="d-dot" />
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs target
    </span>
  )
}

function HeroTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-popover ring-1 ring-foreground/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">{label}</p>
      <p className="font-mono text-sm font-semibold tabular-nums">{formatCurrency(payload[0].value)}</p>
    </div>
  )
}

export const MarketingHero = memo(function MarketingHero({ monday, meta, targets, range, isLoading }: Props) {
  if (isLoading || !monday || !meta) {
    return (
      <div className="section-card">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-8">
          <div className="space-y-4">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-14 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    )
  }

  const spend = meta.spend
  const hasSpend = spend > 0
  // collectedRevenue is the dashboard's primary Revenue + ROAS figure (cash in).
  const revenue = monday.collectedRevenue ?? 0
  const deals = monday.deals
  const roas = safeDivide(revenue, spend)
  const derived = deriveTargets(targets ?? null)
  const roasTarget = derived.roas
  const revTarget = proRata(targets?.revenue ?? 0, range)
  const dealsTarget = proRata(targets?.deals ?? 0, range)

  const clearedPct = roasTarget > 0 ? Math.round((roas / roasTarget) * 100) : 0
  const onTarget = roasTarget > 0 && roas >= roasTarget

  // Weekly revenue trend for the area chart + peak marker.
  const chartData = monday.weekly.map((w) => ({ label: weekLabel(w.weekStart), revenue: w.revenue }))
  const peak = chartData.reduce(
    (best, d, i) => (d.revenue > best.revenue ? { revenue: d.revenue, i } : best),
    { revenue: -Infinity, i: -1 },
  )
  const peakPoint = peak.i >= 0 ? chartData[peak.i] : null

  return (
    <div className="section-card overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-8 items-center">
        {/* ── Left: headline metric ── */}
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70 flex items-center gap-2.5">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", onTarget ? "bg-[var(--st-live)]" : "bg-[var(--st-warn)]")} />
            Attribution · Marketing
          </p>
          <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
            Blended return on ad spend
          </p>
          <p className="mt-1 font-mono text-[54px] font-bold leading-none tracking-tight tabular-nums text-foreground">
            {hasSpend ? formatMultiplier(roas) : "-"}
          </p>
          <div className="mt-3 h-0.5 w-16 rounded-full bg-[var(--teal)]" />
          <p className="mt-3 text-[13px] text-muted-foreground leading-relaxed">
            {hasSpend ? (
              <>
                <span className="font-medium text-foreground/80">{formatCurrency(revenue)}</span> revenue on{" "}
                <span className="font-medium text-foreground/80">{formatCurrency(spend)}</span> spend.
                {roasTarget > 0 && (
                  <> Target {formatMultiplier(roasTarget)} {onTarget ? `cleared by ${clearedPct}%` : `at ${clearedPct}%`}.</>
                )}
              </>
            ) : (
              "No ad spend for this period — ROAS unavailable."
            )}
          </p>

          {/* Sub-stats */}
          <div className="mt-6 grid grid-cols-3 gap-4">
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Revenue</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{formatCurrency(revenue)}</p>
              <TargetDelta current={revenue} target={revTarget} />
            </div>
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Ad Spend</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{hasSpend ? formatCurrencyDecimal(spend) : "-"}</p>
            </div>
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/60">Deals</p>
              <p className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-foreground">{deals}</p>
              <TargetDelta current={deals} target={dealsTarget} />
            </div>
          </div>
        </div>

        {/* ── Right: weekly revenue trend ── */}
        <div className="min-w-0">
          <div className="flex items-baseline justify-between mb-2">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
              Weekly revenue
            </p>
            {peakPoint && peakPoint.revenue > 0 && (
              <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
                Peak {peakPoint.label} · <span className="text-foreground font-semibold">{formatCurrency(peakPoint.revenue)}</span>
              </p>
            )}
          </div>
          {chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No weekly data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="mh-rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8967F3" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#8967F3" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#959AA4", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis hide domain={[0, "dataMax"]} />
                <Tooltip content={<HeroTooltip />} cursor={{ stroke: "#959AA4", strokeDasharray: "3 3" }} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#8967F3"
                  strokeWidth={2.5}
                  fill="url(#mh-rev)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#8967F3" }}
                />
                {peakPoint && peakPoint.revenue > 0 && (
                  <ReferenceDot
                    x={peakPoint.label}
                    y={peakPoint.revenue}
                    r={4}
                    fill="#8967F3"
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
})
