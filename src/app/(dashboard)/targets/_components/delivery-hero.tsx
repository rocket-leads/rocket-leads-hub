"use client"

import { memo } from "react"
import { Trophy } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/targets/formatters"
import type { AccountManagerRevenue } from "@/types/targets"

interface Props {
  teams: AccountManagerRevenue[]
  isLoading: boolean
}

/**
 * Delivery hero as a team competition leaderboard - ranked by service-fee
 * revenue (excl. ad budget). The leaderboard framing is a deliberate motivator:
 * #1 gets the trophy + full-strength purple bar, everyone else sees the gap to
 * the leader. Per-team detail still lives in the "Revenue by Team" cards below.
 */
export const DeliveryHero = memo(function DeliveryHero({ teams, isLoading }: Props) {
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

  const leaderFee = ranked[0].serviceFee || 1

  return (
    <div className="section-card overflow-hidden">
      <div className="flex items-baseline justify-between mb-5">
        <p className="section-title">Team Leaderboard</p>
        <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/60">By service fee</p>
      </div>

      <div className="space-y-3">
        {ranked.map((team, i) => {
          const isLeader = i === 0
          const pct = Math.max(3, (Math.max(0, team.serviceFee) / leaderFee) * 100)
          const gap = ranked[0].serviceFee - team.serviceFee
          return (
            <div key={team.name} className="flex items-center gap-3 sm:gap-4">
              {/* Rank */}
              <div className="flex w-12 shrink-0 items-center gap-1.5">
                <span className={cn(
                  "font-mono text-[24px] font-bold leading-none tabular-nums",
                  isLeader ? "text-[var(--teal)]" : i === 1 ? "text-foreground/70" : "text-muted-foreground/40",
                )}>
                  {i + 1}
                </span>
                {isLeader && <Trophy className="h-4 w-4 text-[var(--teal)]" strokeWidth={2.25} />}
              </div>

              {/* Name + bar + sub-metrics */}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className={cn("truncate", isLeader ? "text-sm font-semibold text-foreground" : "text-[13px] font-medium text-foreground/80")}>
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
                  <div
                    className={cn("h-full rounded-full transition-all duration-700", isLeader ? "bg-[var(--teal)]" : "bg-[var(--teal)]/40")}
                    style={{ width: `${pct}%` }}
                  />
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
      </div>
    </div>
  )
})
