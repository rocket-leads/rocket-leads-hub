"use client"

import { memo } from "react"
import { startOfMonth, differenceInDays, getDaysInMonth, max as dateMax } from "date-fns"
import { Phone, PhoneCall, Handshake, Wallet } from "lucide-react"
import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/targets/formatters"
import { deriveTargets } from "@/lib/targets/calculations"
import type { MondayTargetsData, TargetsConfig, DateRange } from "@/types/targets"

interface Props {
  monday: MondayTargetsData | null
  targets: TargetsConfig | null
  range: DateRange
  isLoading: boolean
}

function proRata(monthlyTarget: number, range: DateRange): number {
  if (monthlyTarget <= 0) return 0
  const refMonthStart = startOfMonth(range.endDate)
  const effectiveStart = dateMax([range.startDate, refMonthStart])
  const days = differenceInDays(range.endDate, effectiveStart) + 1
  const daysInMonth = getDaysInMonth(range.endDate)
  return (monthlyTarget * days) / daysInMonth
}

/** Inline SVG sparkline (area + line) from a weekly series, scaled to a 100×34
 *  viewBox. Stroke is the brand accent (--teal → purple in client.css). */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="spark-wrap" />
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const n = values.length
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * 100
    const y = 32 - ((v - min) / span) * 30 // 1px top/bottom breathing room
    return [x, y] as const
  })
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ")
  const area = `${line} L100 34 L0 34 Z`
  return (
    <div className="spark-wrap">
      <svg viewBox="0 0 100 34" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--teal)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spark-fill)" />
        <path d={line} fill="none" stroke="var(--teal)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

interface Stat {
  icon: ReactNode
  label: string
  value: string
  current: number
  target: number
  series: number[]
}

function StatCard({ stat }: { stat: Stat }) {
  const hasTarget = stat.target > 0
  const pct = hasTarget ? (stat.current / stat.target - 1) * 100 : 0
  const up = pct >= 0
  return (
    <div className="stat-card">
      <div className="row1">
        <div className="row1-left">
          <span className="icon-badge">{stat.icon}</span>
          <span className="cat-label">{stat.label}</span>
        </div>
      </div>
      <div className="hero-num">{stat.value}</div>
      {hasTarget && (
        <span className={cn("delta", up ? "up" : "down")}>
          <span className="d-dot" />
          {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs target
        </span>
      )}
      <Sparkline values={stat.series} />
    </div>
  )
}

/**
 * 187N sparkline stat row for Marketing/Sales - the funnel at a glance with a
 * momentum sparkline (weekly series) + vs-pro-rata-target delta pill on each.
 * Meta only exposes an aggregate spend (no weekly), so the sparkline cards are
 * the funnel-volume metrics we DO have weekly data for.
 */
export const MarketingStatRow = memo(function MarketingStatRow({ monday, targets, range, isLoading }: Props) {
  if (isLoading || !monday) {
    return (
      <div className="stat-row cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat-card">
            <Skeleton className="h-8 w-8 rounded-md mb-4" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-10 w-full mt-4" />
          </div>
        ))}
      </div>
    )
  }

  const weekly = monday.weekly
  // Volume targets (booked/taken calls) are derived from deals × cost ceilings;
  // deals + revenue come straight from Settings.
  const dt = deriveTargets(targets ?? null)
  const stats: Stat[] = [
    {
      icon: <Phone />, label: "Booked Calls", value: String(monday.calls),
      current: monday.calls, target: proRata(dt.calls, range),
      series: weekly.map((w) => w.calls),
    },
    {
      icon: <PhoneCall />, label: "Taken Calls", value: String(monday.takenCalls),
      current: monday.takenCalls, target: proRata(dt.takenCalls, range),
      series: weekly.map((w) => w.taken),
    },
    {
      icon: <Handshake />, label: "Deals", value: String(monday.deals),
      current: monday.deals, target: proRata(targets?.deals ?? 0, range),
      series: weekly.map((w) => w.deals),
    },
    {
      icon: <Wallet />, label: "Closed Revenue", value: formatCurrency(monday.closedRevenue),
      current: monday.closedRevenue, target: proRata(targets?.revenue ?? 0, range),
      series: weekly.map((w) => w.revenue),
    },
  ]

  return (
    <div className="stat-row cols-4">
      {stats.map((s) => <StatCard key={s.label} stat={s} />)}
    </div>
  )
})
