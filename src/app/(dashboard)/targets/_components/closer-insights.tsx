"use client"

import { memo, useState } from "react"
import { AlertCircle, AlertOctagon, CheckCircle2, Lightbulb } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { CloserData } from "@/types/targets"
import { formatCurrency, formatPercent, safeDivide } from "@/lib/targets/formatters"

interface Insight {
  type: "positive" | "warning" | "critical"
  text: string
}

const STATUS_ICON: Record<Insight["type"], { icon: LucideIcon; color: string }> = {
  positive: { icon: CheckCircle2, color: "text-[var(--st-live)]" },
  warning: { icon: AlertCircle, color: "text-[var(--st-warn)]" },
  critical: { icon: AlertOctagon, color: "text-[var(--st-error)]" },
}

// Targets from the brand playbook (Pillars 3 & 4)
const SHOW_UP_TARGET = 0.80
const CONV_TARGET = 0.30

// Sample-size minimums to keep insights from firing on noise
const MIN_QUALIFIED = 3
const MIN_TAKEN = 3
const MIN_DEALS = 2
const NOT_UPDATED_THRESHOLD = 3

function generateCloserInsights(closers: CloserData[]): Insight[] {
  const active = closers.filter(
    (c) => c.qualifiedCalls > 0 || c.upcomingCalls > 0 || c.takenCalls > 0 || c.deals > 0 || c.notUpdated > 0,
  )
  if (active.length === 0) return []

  const insights: Insight[] = []

  // Team baselines - Not Updated is folded into takenCalls so the conversion
  // rate can't be gamed; show-up rate uses qualifiedCalls (all past) as denom.
  const totalQualified = active.reduce((s, c) => s + c.qualifiedCalls, 0)
  const totalTaken = active.reduce((s, c) => s + c.takenCalls, 0)
  const totalDeals = active.reduce((s, c) => s + c.deals, 0)
  const totalRevenue = active.reduce((s, c) => s + c.revenue, 0)
  const teamShowUp = safeDivide(totalTaken, totalQualified)
  const teamConv = safeDivide(totalDeals, totalTaken)
  const teamAvgDeal = safeDivide(totalRevenue, totalDeals)

  // ── Show-up rate ─────────────────────────────────────────────────
  const showUpData = active
    .filter((c) => c.qualifiedCalls >= MIN_QUALIFIED)
    .map((c) => ({ closer: c.closer, rate: safeDivide(c.takenCalls, c.qualifiedCalls), taken: c.takenCalls, booked: c.qualifiedCalls }))
  const bestShowUp = [...showUpData].sort((a, b) => b.rate - a.rate)[0]
  const worstShowUp = [...showUpData].sort((a, b) => a.rate - b.rate)[0]

  if (bestShowUp && bestShowUp.rate >= 0.85) {
    insights.push({
      type: "positive",
      text: `${bestShowUp.closer}: ${formatPercent(bestShowUp.rate)} show-up rate (${bestShowUp.taken}/${bestShowUp.booked}) - strongest on the team.`,
    })
  }
  if (worstShowUp && worstShowUp.rate < SHOW_UP_TARGET && worstShowUp.closer !== bestShowUp?.closer) {
    const teamRef = active.length > 1 ? ` and team avg ${formatPercent(teamShowUp)}` : ""
    insights.push({
      type: worstShowUp.rate < 0.6 ? "critical" : "warning",
      text: `${worstShowUp.closer}: ${formatPercent(worstShowUp.rate)} show-up rate (${worstShowUp.taken}/${worstShowUp.booked}) - below ${formatPercent(SHOW_UP_TARGET)} target${teamRef}. Audit reminder flow & confirmation calls for their leads.`,
    })
  }

  // ── Conversion rate ──────────────────────────────────────────────
  const convData = active
    .filter((c) => c.takenCalls >= MIN_TAKEN)
    .map((c) => ({ closer: c.closer, rate: c.deals / c.takenCalls, deals: c.deals, taken: c.takenCalls }))
  const bestConv = [...convData].sort((a, b) => b.rate - a.rate)[0]
  const worstConv = [...convData].sort((a, b) => a.rate - b.rate)[0]

  if (bestConv && bestConv.rate >= 0.4) {
    insights.push({
      type: "positive",
      text: `${bestConv.closer}: ${formatPercent(bestConv.rate)} conversion (${bestConv.deals}/${bestConv.taken}) - top closer this period.`,
    })
  }
  if (worstConv && worstConv.rate < CONV_TARGET && worstConv.closer !== bestConv?.closer) {
    const teamRef = active.length > 1 ? ` (team avg ${formatPercent(teamConv)})` : ""
    insights.push({
      type: worstConv.rate < 0.15 ? "critical" : "warning",
      text: `${worstConv.closer}: ${formatPercent(worstConv.rate)} conversion (${worstConv.deals}/${worstConv.taken}) - below ${formatPercent(CONV_TARGET)} target${teamRef}. Sales coaching or proposition review needed.`,
    })
  }

  // ── Avg deal size ────────────────────────────────────────────────
  if (teamAvgDeal > 0) {
    const dealData = active
      .filter((c) => c.deals >= MIN_DEALS)
      .map((c) => ({ closer: c.closer, avg: c.revenue / c.deals, deals: c.deals }))
    const bestDeal = [...dealData].sort((a, b) => b.avg - a.avg)[0]
    const worstDeal = [...dealData].sort((a, b) => a.avg - b.avg)[0]

    if (bestDeal && bestDeal.avg >= teamAvgDeal * 1.2) {
      const diff = Math.round((bestDeal.avg / teamAvgDeal - 1) * 100)
      insights.push({
        type: "positive",
        text: `${bestDeal.closer}: ${formatCurrency(bestDeal.avg)} avg deal - ${diff}% above team avg of ${formatCurrency(teamAvgDeal)}.`,
      })
    }
    if (worstDeal && worstDeal.avg < teamAvgDeal * 0.8 && worstDeal.closer !== bestDeal?.closer) {
      const diff = Math.round((1 - worstDeal.avg / teamAvgDeal) * 100)
      insights.push({
        type: "warning",
        text: `${worstDeal.closer}: ${formatCurrency(worstDeal.avg)} avg deal - ${diff}% below team avg. Steer toward HTO packages or review discounting practices.`,
      })
    }
  }

  // ── Not Updated alerts ───────────────────────────────────────────
  const sluggish = active
    .filter((c) => c.notUpdated >= NOT_UPDATED_THRESHOLD)
    .sort((a, b) => b.notUpdated - a.notUpdated)
  for (const c of sluggish.slice(0, 3)) {
    insights.push({
      type: c.notUpdated >= 6 ? "critical" : "warning",
      text: `${c.closer}: ${c.notUpdated} past appointments still in Qualified/Gepland - status hasn't been updated, real performance is hidden.`,
    })
  }

  return insights
}

interface Props {
  data: CloserData[]
  isLoading: boolean
}

const LIMIT = 3

export const CloserInsights = memo(function CloserInsights({ data, isLoading }: Props) {
  const [showAll, setShowAll] = useState(false)
  if (isLoading) {
    return (
      <div className="section-card">
        <div className="section-head">
          <div className="section-title">
            <Lightbulb className="h-3.5 w-3.5" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
        </div>
      </div>
    )
  }

  const insights = generateCloserInsights(data)
  const visible = showAll ? insights : insights.slice(0, LIMIT)

  return (
    <div className="section-card">
      <div className="section-head">
        <div className="section-title">
          <Lightbulb className="h-3.5 w-3.5" />
          Closer Insights
          {insights.length > 0 && <span className="count">{insights.length}</span>}
        </div>
      </div>
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground leading-relaxed">Not enough closer data this period to surface patterns.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((insight, i) => {
            const { icon: Icon, color } = STATUS_ICON[insight.type]
            return (
              <div key={i} className="flex items-start gap-2.5">
                <Icon className={`h-4 w-4 shrink-0 mt-px ${color}`} strokeWidth={2.25} />
                <p className="text-sm text-foreground leading-relaxed">{insight.text}</p>
              </div>
            )
          })}
          {insights.length > LIMIT && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
            >
              {showAll ? "Show less" : `Show all ${insights.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
})
