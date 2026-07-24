"use client"

import { memo } from "react"
import { Trophy, AlertTriangle } from "lucide-react"
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/targets/formatters"
import type { AccountManagerRevenue } from "@/types/targets"

interface Props {
  teams: AccountManagerRevenue[]
  /** The "Unassigned" bucket (from byAccountManager) - revenue not yet mapped to a team. */
  unassigned: AccountManagerRevenue | null
  isLoading: boolean
}

// Each team gets its own solid identity colour - a cohesive purple→blue family
// (all cool, on-brand). Bar LENGTH shows performance; colour is just identity.
// #1 additionally gets the trophy. No green (reserved for status), no orange.
const TEAM_COLORS = ["#8967F3", "#9B7BF6", "#7E86F3", "#6E97F1", "#5FA8EC", "#59BEE6"]
const UNASSIGNED_COLOR = "#CC8A2C" // amber = needs attention

export const DeliveryHero = memo(function DeliveryHero({ teams, unassigned, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="section-card">
        <Skeleton className="h-3 w-40 mb-5" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </div>
    )
  }

  const ranked = [...teams]
    .filter((t) => t.name !== "Unassigned")
    .sort((a, b) => b.serviceFee - a.serviceFee)

  if (ranked.length === 0) return null

  const scaleMax = Math.max(ranked[0].serviceFee, unassigned?.serviceFee ?? 0) || 1
  const showUnassigned = !!unassigned && unassigned.serviceFee > 0

  // Donut = each team's share of total service fee + the unassigned bucket.
  const donut = [
    ...ranked.map((t, i) => ({ name: t.name, value: Math.max(0, t.serviceFee), color: TEAM_COLORS[i % TEAM_COLORS.length] })),
    ...(showUnassigned ? [{ name: "Unassigned", value: Math.max(0, unassigned!.serviceFee), color: UNASSIGNED_COLOR }] : []),
  ].filter((d) => d.value > 0)
  const donutTotal = donut.reduce((s, d) => s + d.value, 0) || 1

  return (
    <div className="section-card overflow-hidden">
      <div className="mb-5 flex items-baseline justify-between">
        <p className="section-title">Team Leaderboard</p>
        <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/60">By service fee</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.5fr_1fr] lg:items-center">
        {/* ── Leaderboard ── */}
        <div className="space-y-3">
          {ranked.map((team, i) => {
            const isLeader = i === 0
            const color = TEAM_COLORS[i % TEAM_COLORS.length]
            const pct = Math.max(3, (Math.max(0, team.serviceFee) / scaleMax) * 100)
            const gap = ranked[0].serviceFee - team.serviceFee
            return (
              <div key={team.name} className="flex items-center gap-3 sm:gap-4">
                <div className="flex w-12 shrink-0 items-center gap-1.5">
                  <span
                    className={cn("font-mono text-[24px] leading-none tabular-nums", isLeader ? "font-bold" : "font-semibold")}
                    style={{ color }}
                  >
                    {i + 1}
                  </span>
                  {isLeader && <Trophy className="h-4 w-4" style={{ color }} strokeWidth={2.25} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className={cn("truncate", isLeader ? "text-sm font-semibold text-foreground" : "text-[13px] font-medium text-foreground/85")}>
                      {team.name}
                    </span>
                    <div className="flex shrink-0 items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold tabular-nums">{formatCurrency(team.serviceFee)}</span>
                      {!isLeader && gap > 0 && (
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/50">−{formatCurrency(gap)}</span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                  <div className="mt-1 flex items-center gap-2.5 font-mono text-[10px] text-muted-foreground/60">
                    <span>{team.customers} client{team.customers === 1 ? "" : "s"}</span>
                    <span>·</span>
                    <span>MRR {formatCurrency(team.mrr)}</span>
                    <span>·</span>
                    <span>NB {formatCurrency(team.newBusiness)}</span>
                  </div>
                </div>
              </div>
            )
          })}

          {showUnassigned && (
            <div className="flex items-center gap-3 border-t border-border/40 pt-3 sm:gap-4">
              <div className="flex w-12 shrink-0 items-center">
                <AlertTriangle className="h-4 w-4 text-[var(--st-warn)]" strokeWidth={2.25} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-[var(--st-warn)]">Unassigned</span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-[var(--st-warn)]">{formatCurrency(unassigned!.serviceFee)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-[var(--st-warn)]" style={{ width: `${Math.min(100, Math.max(3, (unassigned!.serviceFee / scaleMax) * 100))}%` }} />
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                  {unassigned!.customers} client{unassigned!.customers === 1 ? "" : "s"} not mapped to a team — assign below to credit the right team
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Share donut ── */}
        <div className="min-w-0">
          <div className="relative mx-auto h-[168px] w-[168px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donut}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="66%"
                  outerRadius="100%"
                  paddingAngle={1.5}
                  strokeWidth={0}
                  startAngle={90}
                  endAngle={-270}
                >
                  {donut.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-[20px] font-bold leading-none tabular-nums text-foreground">{formatCurrency(donutTotal)}</span>
              <span className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">Service fee</span>
            </div>
          </div>

          {/* Legend with percentages */}
          <div className="mt-4 space-y-1.5">
            {donut.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-[12px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
                <span className="min-w-0 flex-1 truncate text-foreground/80">{d.name}</span>
                <span className="font-mono tabular-nums text-muted-foreground/60">{formatCurrency(d.value)}</span>
                <span className="w-9 text-right font-mono font-semibold tabular-nums">{((d.value / donutTotal) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})
