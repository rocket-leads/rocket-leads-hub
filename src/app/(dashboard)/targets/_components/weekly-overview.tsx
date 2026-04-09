"use client"

import { memo } from "react"
import type { WeeklyData } from "@/types/targets"
import { formatCurrency } from "@/lib/targets/formatters"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts"

interface Props {
  data: WeeklyData[]
  isLoading: boolean
}

function weekLabel(weekStart: string): string {
  const d = new Date(weekStart)
  const end = new Date(d)
  end.setDate(end.getDate() + 6)
  const fmt = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  return `${fmt(d)} – ${fmt(end)}`
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl">
      <p className="text-xs text-muted-foreground mb-2 font-medium">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground">{entry.name}</span>
          </div>
          <span className="font-mono text-foreground">
            {entry.name === "Revenue" ? formatCurrency(entry.value) : entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export const WeeklyOverview = memo(function WeeklyOverview({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <Skeleton className="h-4 w-40 mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!data.length) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Weekly Overview</h3>
        <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
          No weekly data available
        </div>
      </div>
    )
  }

  const chartData = data.map((w) => ({ ...w, label: weekLabel(w.weekStart) }))

  return (
    <div className="bg-card rounded-lg p-4 border border-border/40">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Weekly Overview</h3>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="left" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `€${Math.round(v / 1000)}k`} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconType="circle" iconSize={6} />
          <Bar yAxisId="left" dataKey="calls" name="Calls" fill="hsl(var(--muted))" radius={[2, 2, 0, 0]} barSize={18} />
          <Bar yAxisId="left" dataKey="qualified" name="Qualified" fill="#8967F3" radius={[2, 2, 0, 0]} barSize={18} />
          <Bar yAxisId="left" dataKey="taken" name="Taken" fill="#8967F366" radius={[2, 2, 0, 0]} barSize={18} />
          <Bar yAxisId="left" dataKey="deals" name="Deals" fill="#22c55e" radius={[2, 2, 0, 0]} barSize={18} />
          <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="#8967F3" strokeWidth={2} dot={{ fill: "#8967F3", r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})
