"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { TrendResponse, TrendPoint } from "@/app/api/clients/[id]/trend/route"

/**
 * Per-client CPL + Ad Spend trend chart, rendered below the 4 KPI cards
 * on the home tab. Two lines on a shared X-axis:
 *
 *   - CPL  → left Y-axis, brand purple, decimal € (gap = zero-lead day)
 *   - Spend → right Y-axis, brand mint, integer €
 *
 * Window selector: 14d / 30d / 90d, default 30d. Data comes from the
 * 120d kpi_daily cron cache via `/api/clients/[id]/trend?days=N`.
 *
 * The "ad spend stayed stable while CPL moved" question is the whole
 * reason this view exists - so the two lines share an X-axis but use
 * separate Y-axes so each can scale independently and neither is
 * dwarfed by the other.
 */

const WINDOW_OPTIONS = [14, 30, 90] as const
type WindowDays = (typeof WINDOW_OPTIONS)[number]
const DEFAULT_WINDOW: WindowDays = 30

const CPL_COLOR = "#8967F3"    // brand purple
const SPEND_COLOR = "#7AF5D0"  // brand mint (gradient endpoint)

type Props = {
  mondayItemId: string
}

export function TrendChart({ mondayItemId }: Props) {
  const [windowDays, setWindowDays] = useState<WindowDays>(DEFAULT_WINDOW)

  const { data, isLoading } = useQuery<TrendResponse>({
    queryKey: ["client-trend", mondayItemId, windowDays],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/trend?days=${windowDays}`).then((r) => r.json()),
    enabled: !!mondayItemId,
    // kpi_daily cron writes daily; 1h stale window is generous.
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  return (
    <div className="bg-card rounded-lg border border-border/40 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          CPL &amp; Ad Spend trend
        </h3>
        <WindowToggle value={windowDays} onChange={setWindowDays} />
      </div>

      {isLoading ? (
        <Skeleton className="h-60 w-full" />
      ) : !data || data.points.length === 0 ? (
        <EmptyState />
      ) : (
        <Chart points={data.points} windowDays={windowDays} />
      )}
    </div>
  )
}

function WindowToggle({
  value,
  onChange,
}: {
  value: WindowDays
  onChange: (v: WindowDays) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-border/40 p-0.5">
      {WINDOW_OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "h-7 px-2.5 text-[11px] font-medium rounded-sm tabular-nums transition-colors",
            value === opt
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
          )}
        >
          {opt}d
        </button>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="h-60 flex items-center justify-center text-xs text-muted-foreground/60">
      No daily data cached yet for this client.
    </div>
  )
}

/** Trailing-window smoothing widths per chart range. Raw daily Meta CPL
 *  bounces hard on auction noise; smoothing reveals the actual trend.
 *  Width grows with range to keep the line visually steady at the same
 *  zoom level - 90d would be a chaotic squiggle with a 3d window. */
function smoothingWindow(windowDays: WindowDays): number {
  if (windowDays === 14) return 3
  if (windowDays === 30) return 5
  return 7
}

type SmoothedPoint = TrendPoint & {
  /** Trailing moving average; null when no leads in the entire window. */
  cplSmoothed: number | null
  spendSmoothed: number
}

/** Apply a trailing moving average to CPL + Spend. CPL nulls (zero-lead
 *  days) are skipped in the window mean - the line just gets a slightly
 *  noisier sample for that segment instead of dropping to zero. */
function smoothPoints(points: TrendPoint[], window: number): SmoothedPoint[] {
  return points.map((p, i) => {
    const start = Math.max(0, i - window + 1)
    const slice = points.slice(start, i + 1)

    const cplValues = slice
      .map((s) => s.cpl)
      .filter((v): v is number => v != null && v > 0)
    const cplSmoothed = cplValues.length > 0
      ? Number((cplValues.reduce((s, v) => s + v, 0) / cplValues.length).toFixed(2))
      : null

    const spendSmoothed = Number(
      (slice.reduce((s, v) => s + v.spend, 0) / slice.length).toFixed(2),
    )

    return { ...p, cplSmoothed, spendSmoothed }
  })
}

function Chart({ points, windowDays }: { points: TrendPoint[]; windowDays: WindowDays }) {
  // Smoothed series memoised on the raw points + window - cheap (≤90
  // entries) but no point recomputing on every Tooltip hover.
  const smoothed = useMemo(
    () => smoothPoints(points, smoothingWindow(windowDays)),
    [points, windowDays],
  )

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={smoothed} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
        <XAxis
          dataKey="date"
          tick={{ fill: "#959AA4", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatDateTick}
          minTickGap={24}
        />
        {/* Left axis = CPL (€ with cents, smaller numbers). */}
        <YAxis
          yAxisId="cpl"
          orientation="left"
          tick={{ fill: "#959AA4", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `€${v.toFixed(0)}`}
          width={42}
        />
        {/* Right axis = Spend (integer € or €k for large accounts). */}
        <YAxis
          yAxisId="spend"
          orientation="right"
          tick={{ fill: "#959AA4", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatSpendTick}
          width={48}
        />
        <Tooltip content={<TrendTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
          iconType="circle"
          iconSize={6}
          formatter={(value: string) => (
            <span className="text-muted-foreground">{value}</span>
          )}
        />
        {/* connectNulls=false on smoothed CPL so a fully zero-lead window
            still renders as a visual gap. monotone stays the curve type
            but now on smoothed data - so it draws clean rolling waves
            instead of wild S-curves around daily spikes. */}
        <Line
          yAxisId="cpl"
          type="monotone"
          dataKey="cplSmoothed"
          name="CPL"
          stroke={CPL_COLOR}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          activeDot={{ r: 4, fill: CPL_COLOR }}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="spend"
          type="monotone"
          dataKey="spendSmoothed"
          name="Ad Spend"
          stroke={SPEND_COLOR}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          activeDot={{ r: 4, fill: SPEND_COLOR }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  /** Recharts hands the full data point as `payload[i].payload` - we read
   *  the RAW cpl / spend from there instead of `entry.value` (which is
   *  the smoothed series the line is drawn from). Tooltip must show the
   *  actual day's number, not the rolling mean. */
  payload?: Array<{ name: string; value: number | null; color: string; payload: SmoothedPoint }>
  label?: string
}) {
  if (!active || !payload?.length || !label) return null
  const raw = payload[0]?.payload
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl">
      <p className="text-[11px] text-muted-foreground mb-2 font-medium">{formatDateLabel(label)}</p>
      {payload.map((entry) => {
        const rawValue =
          entry.name === "CPL" ? raw?.cpl ?? null : entry.name === "Ad Spend" ? raw?.spend ?? 0 : entry.value
        return (
          <div key={entry.name} className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-muted-foreground">{entry.name}</span>
            </div>
            <span className="font-mono text-foreground">
              {rawValue == null
                ? "—"
                : entry.name === "CPL"
                  ? `€${rawValue.toFixed(2)}`
                  : `€${Math.round(rawValue).toLocaleString("en-GB")}`}
            </span>
          </div>
        )
      })}
      {raw && (
        <p className="text-[10px] text-muted-foreground/50 mt-1.5 pt-1.5 border-t border-border/40">
          Line: rolling avg · Value shown: that day&apos;s actual
        </p>
      )}
    </div>
  )
}

function formatDateTick(iso: string): string {
  // Short tick labels: "12 Jun"
  const d = new Date(iso + "T00:00:00Z")
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}

function formatDateLabel(iso: string): string {
  // Tooltip header: "Thu 12 Jun"
  const d = new Date(iso + "T00:00:00Z")
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}

function formatSpendTick(v: number): string {
  if (v >= 1000) return `€${(v / 1000).toFixed(0)}k`
  return `€${Math.round(v)}`
}
