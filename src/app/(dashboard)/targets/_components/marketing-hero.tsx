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

/** Pro-rata a monthly target to where we should be by this day of the month. */
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

/**
 * One metric row: label · value · status. `tone="auto"` colours the delta
 * green/red by higher-is-better vs its target; `tone="neutral"` shows the delta
 * muted (for ad spend, where over/under the plan isn't inherently good or bad).
 */
function MetricRow({
  label, value, current, target, tone = "auto", showStatus = true,
}: {
  label: string
  value: string
  current: number
  target: number
  tone?: "auto" | "neutral"
  showStatus?: boolean
}) {
  // Show attainment as a % OF the (pace-adjusted or ratio) target - 121% reads as
  // "21% ahead", 88% as "12% behind", green at/over 100%, red under.
  const has = showStatus && target > 0 && isFinite(current)
  const pctOfTarget = has ? (current / target) * 100 : null
  const good = pctOfTarget !== null && pctOfTarget >= 100
  const color = pctOfTarget === null
    ? ""
    : tone === "neutral"
    ? "text-muted-foreground/50"
    : good
    ? "text-[var(--st-live)]"
    : "text-[var(--st-error)]"
  return (
    <div className="grid grid-cols-[1fr_auto_56px] items-baseline gap-x-3 py-2">
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <span className="font-mono text-[15px] font-semibold tabular-nums text-foreground text-right">{value}</span>
      {pctOfTarget !== null && isFinite(pctOfTarget) ? (
        <span className={cn("font-mono text-[12px] font-semibold tabular-nums whitespace-nowrap text-right", color)}>
          {Math.round(pctOfTarget)}%
        </span>
      ) : (
        <span className="text-right font-mono text-[11px] text-muted-foreground/30">–</span>
      )}
    </div>
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
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-8">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    )
  }

  const spend = meta.spend
  const hasSpend = spend > 0
  const closedRevenue = monday.closedRevenue ?? 0
  // collectedRevenue = cash actually in the door; the primary ROAS numerator.
  const collectedRevenue = monday.collectedRevenue ?? 0
  const deals = monday.deals
  const roas = safeDivide(collectedRevenue, spend)
  const avgDealValue = safeDivide(closedRevenue, deals)
  const avgCollected = safeDivide(collectedRevenue, deals)

  const t = targets
  const derived = deriveTargets(t ?? null)

  // Pace (day-of-month) targets for the cumulative money/volume metrics.
  const adSpendPace = proRata(derived.adSpend, range)
  const dealsPace = proRata(t?.deals ?? 0, range)
  const closedPace = proRata(t?.revenue ?? 0, range)
  const collectedPace = proRata(t?.collectedRevenue ?? 0, range)
  // Ratio targets (not pace-adjusted - ratios don't accumulate over the month).
  const roasTarget = derived.roas
  const avgDealTarget = safeDivide(t?.revenue ?? 0, t?.deals ?? 0)
  const avgCollectedTarget = safeDivide(t?.collectedRevenue ?? 0, t?.deals ?? 0)

  // Kicker health = is the money actually landing on pace (cash collected).
  const onTrack = collectedPace > 0 && collectedRevenue >= collectedPace

  // Weekly revenue trend for the area chart + peak marker.
  const chartData = monday.weekly.map((w) => ({ label: weekLabel(w.weekStart), revenue: w.revenue }))
  const peak = chartData.reduce(
    (best, d, i) => (d.revenue > best.revenue ? { revenue: d.revenue, i } : best),
    { revenue: -Infinity, i: -1 },
  )
  const peakPoint = peak.i >= 0 ? chartData[peak.i] : null

  return (
    <div className="section-card overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-8 items-center">
        {/* ── Left: new-business scoreboard ── */}
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70 flex items-center gap-2.5">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", onTrack ? "bg-[var(--st-live)]" : "bg-[var(--st-warn)]")} />
            Marketing · New Business
          </p>

          <div className="mt-4 flex items-baseline justify-end">
            <p className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/40">% of pace target</p>
          </div>
          <div className="mt-1 divide-y divide-border/30">
            <MetricRow label="Ad Spend" value={hasSpend ? formatCurrencyDecimal(spend) : "–"} current={spend} target={adSpendPace} tone="neutral" showStatus={hasSpend} />
            <MetricRow label="ROAS" value={hasSpend ? formatMultiplier(roas) : "–"} current={roas} target={roasTarget} showStatus={hasSpend} />
            <MetricRow label="Deals" value={String(deals)} current={deals} target={dealsPace} />
            <MetricRow label="Closed Deal Revenue" value={formatCurrency(closedRevenue)} current={closedRevenue} target={closedPace} />
            <MetricRow label="Cash Collected" value={formatCurrency(collectedRevenue)} current={collectedRevenue} target={collectedPace} />
          </div>

          <div className="mt-3 border-t border-border/40 pt-3">
            <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/50">Efficiency · per deal</p>
            <div className="divide-y divide-border/30">
              <MetricRow label="Average Deal Value" value={deals > 0 ? formatCurrency(avgDealValue) : "–"} current={avgDealValue} target={avgDealTarget} showStatus={deals > 0} />
              <MetricRow label="Average Collected / Deal" value={deals > 0 ? formatCurrency(avgCollected) : "–"} current={avgCollected} target={avgCollectedTarget} showStatus={deals > 0} />
            </div>
          </div>
        </div>

        {/* ── Right: weekly revenue trend (unchanged) ── */}
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
