import { TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "./skeleton"

type Trend = {
  /** Signed percentage (+12.5 → "+12.5%", -8 → "-8%"). 0 renders as neutral. */
  pct: number
  /** Optional one-line interpretation under the number (eg. "Trending up this
   *  week", "Stable", "Lowest since launch"). Pure text, no logic. */
  caption?: string
  /** Override the up/down direction inferred from `pct` sign. Use when the
   *  metric's "good" direction is reversed (eg. CPL — down is good). */
  goodWhen?: "up" | "down"
}

type Props = {
  /** Small uppercased label above the number (Flow + herMon both do this). */
  label: string
  /** The hero number. Pre-formatted string so the component stays
   *  formatting-agnostic (euro, %, count, time). */
  value: React.ReactNode
  /** Optional sub-line under the number. Replaced by trend caption when both
   *  exist (trend wins). */
  sub?: React.ReactNode
  /** Optional period-over-period trend chip + caption. */
  trend?: Trend
  loading?: boolean
  className?: string
}

function fmtPct(pct: number): string {
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`
}

/**
 * Hub KPI tile — the herMon dashboard pattern (label, delta chip top-right,
 * big number, trend caption underneath). Used everywhere we surface a metric
 * card: Home, Targets, Watch List, Client home tab.
 *
 * Trend chip greens / reds itself based on `pct` sign + the optional
 * `goodWhen` override. Without `goodWhen`, up=good (revenue, leads). With
 * `goodWhen="down"`, the convention flips (CPL, CPA, churn).
 */
export function KpiTile({ label, value, sub, trend, loading, className }: Props) {
  // Decide tone: a metric where "up is bad" (eg. CPL) needs to flip the chip.
  const isPositive = trend
    ? (trend.goodWhen === "down" ? trend.pct < 0 : trend.pct > 0)
    : false
  const isNegative = trend
    ? (trend.goodWhen === "down" ? trend.pct > 0 : trend.pct < 0)
    : false
  const isNeutral = trend && !isPositive && !isNegative

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card px-5 py-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">
          {label}
        </span>
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 h-[20px] text-[11px] font-medium tabular-nums",
              isPositive && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              isNegative && "bg-red-500/10 text-red-600 dark:text-red-400",
              isNeutral && "bg-muted/60 text-muted-foreground",
            )}
          >
            {isPositive ? (
              <TrendingUp className="h-3 w-3" />
            ) : isNegative ? (
              <TrendingDown className="h-3 w-3" />
            ) : null}
            {fmtPct(trend.pct)}
          </span>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className="font-heading text-[26px] font-bold tracking-tight tabular-nums leading-none text-foreground">
          {value}
        </p>
      )}

      {(trend?.caption || sub) && (
        <p className="mt-2 text-[11px] text-muted-foreground/70 leading-snug">
          {trend?.caption ?? sub}
        </p>
      )}
    </div>
  )
}
