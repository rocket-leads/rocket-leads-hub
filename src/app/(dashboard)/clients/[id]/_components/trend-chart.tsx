"use client"

import { useState } from "react"
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
        <Chart points={data.points} />
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

function Chart({ points }: { points: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={points} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
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
        {/* connectNulls=false so zero-lead days are visual gaps - prevents a
            misleading "CPL dropped to €0" rendering on idle days. */}
        <Line
          yAxisId="cpl"
          type="monotone"
          dataKey="cpl"
          name="CPL"
          stroke={CPL_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: CPL_COLOR }}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="spend"
          type="monotone"
          dataKey="spend"
          name="Ad Spend"
          stroke={SPEND_COLOR}
          strokeWidth={2}
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
  payload?: Array<{ name: string; value: number | null; color: string }>
  label?: string
}) {
  if (!active || !payload?.length || !label) return null
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl">
      <p className="text-[11px] text-muted-foreground mb-2 font-medium">{formatDateLabel(label)}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground">{entry.name}</span>
          </div>
          <span className="font-mono text-foreground">
            {entry.value == null
              ? "—"
              : entry.name === "CPL"
                ? `€${entry.value.toFixed(2)}`
                : `€${Math.round(entry.value).toLocaleString("en-GB")}`}
          </span>
        </div>
      ))}
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
