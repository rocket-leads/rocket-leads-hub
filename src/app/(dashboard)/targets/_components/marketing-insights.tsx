"use client"

import { memo } from "react"
import { startOfMonth, differenceInDays, getDaysInMonth, max as dateMax } from "date-fns"
import { Lightbulb, TrendingUp } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatCurrencyDecimal, formatPercent, safeDivide } from "@/lib/targets/formatters"
import type { MondayTargetsData, MetaTargetsData, TargetsConfig, DateRange } from "@/types/targets"

interface Props {
  monday: MondayTargetsData | null
  meta: MetaTargetsData | null
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

function pct(val: number, target: number): number {
  return target > 0 ? (val / target) * 100 : 0
}

interface Insight {
  type: "positive" | "warning" | "critical"
  text: string
}

function generateInsights(
  m: MondayTargetsData,
  meta: MetaTargetsData,
  t: TargetsConfig,
  range: DateRange,
): Insight[] {
  const insights: Insight[] = []
  const spend = meta.spend
  const calls = m.calls
  const qualified = m.qualifiedCalls
  const taken = m.takenCalls
  const deals = m.deals
  const revenue = m.closedRevenue

  const prCalls = Math.round(proRata(t.calls, range))
  const prTaken = Math.round(proRata(t.takenCalls, range))
  const prDeals = Math.round(proRata(t.deals, range))
  const prRevenue = Math.round(proRata(t.revenue, range))

  const cbc = safeDivide(spend, calls)
  const cqc = safeDivide(spend, qualified)
  const ctc = safeDivide(spend, taken)
  const cpd = safeDivide(spend, deals)
  const cbcOnTrack = t.cbc > 0 && cbc <= t.cbc
  const cqcOnTrack = t.cqc > 0 && cqc <= t.cqc
  const ctcOnTrack = t.ctc > 0 && ctc <= t.ctc
  const callsOnTrack = prCalls > 0 && calls >= prCalls
  const takenOnTrack = prTaken > 0 && taken >= prTaken
  const qualRate = safeDivide(qualified, calls)
  const showUpRate = safeDivide(taken, qualified)
  const roas = safeDivide(revenue, spend)
  const avgDealValue = deals > 0 ? revenue / deals : 0
  const expectedDealValue = t.deals > 0 && t.revenue > 0 ? t.revenue / t.deals : 0

  // ── COMBINED: Front-of-funnel vs back-of-funnel analysis ──
  // Only surface the interesting conclusion, not every individual metric
  if (cbcOnTrack && cqcOnTrack && !takenOnTrack && showUpRate < 0.8 && qualified > 3) {
    // Front is fine, back is broken by show-up rate
    insights.push({
      type: "warning",
      text: `CBC (${formatCurrencyDecimal(cbc)}) and CQC (${formatCurrencyDecimal(cqc)}) are on track — front of funnel is efficient. But show-up rate of ${formatPercent(showUpRate)} is pulling taken calls off track (${taken}/${prTaken}). The bottleneck is no-shows, not lead generation.`,
    })
  } else if (t.cbc > 0 && cbc > t.cbc && t.ctc > 0 && ctcOnTrack && showUpRate >= 0.8) {
    // CBC/CQC off track but compensated by high show-up
    insights.push({
      type: "positive",
      text: `CBC (${formatCurrencyDecimal(cbc)}) and CQC (${formatCurrencyDecimal(cqc)}) exceed targets, but a strong show-up rate of ${formatPercent(showUpRate)} compensates — CTC stays on track at ${formatCurrencyDecimal(ctc)}. No action needed on costs.`,
    })
  } else if (cbcOnTrack && !callsOnTrack && prCalls > 0) {
    // Efficient but not enough volume = spend issue
    const neededSpend = t.cbc * prCalls
    insights.push({
      type: "warning",
      text: `Cost efficiency is on track (CBC ${formatCurrencyDecimal(cbc)}, CQC ${formatCurrencyDecimal(cqc)}), but booked calls are behind (${calls}/${prCalls}). Ad spend of ${formatCurrencyDecimal(spend)} is too low — need ~${formatCurrencyDecimal(neededSpend)} to hit call target at current efficiency.`,
    })
  } else if (t.cbc > 0 && cbc > t.cbc && !ctcOnTrack) {
    // Everything is off
    insights.push({
      type: "critical",
      text: `Cost efficiency is off track across the funnel: CBC ${formatCurrencyDecimal(cbc)} (target ${formatCurrencyDecimal(t.cbc)}), CTC ${formatCurrencyDecimal(ctc)} (target ${formatCurrencyDecimal(t.ctc)}). Creatives need a refresh.`,
    })
  }

  // ── MISALIGNMENT: Deal value vs revenue target ──
  if (deals > 0 && expectedDealValue > 0 && avgDealValue < expectedDealValue * 0.8) {
    const projectedRevenue = Math.round(prDeals * avgDealValue)
    insights.push({
      type: "warning",
      text: `Avg deal value is ${formatCurrency(avgDealValue)} vs ${formatCurrency(expectedDealValue)} expected. Even hitting all ${t.deals} deals this month would only reach ~${formatCurrency(t.deals * avgDealValue)} — short of the ${formatCurrency(t.revenue)} revenue target.`,
    })
  }

  // ── ROAS (the ultimate metric) ──
  if (spend > 0 && deals > 0) {
    if (roas >= 4) {
      insights.push({ type: "positive", text: `ROAS at ${roas.toFixed(1)}× (target: 4×). Spend is converting efficiently into revenue.` })
    } else {
      const mainDriver = cpd > (t.cpd || Infinity)
        ? `high CPD (${formatCurrencyDecimal(cpd)})`
        : `low avg deal value (${formatCurrency(avgDealValue)})`
      insights.push({ type: roas < 3 ? "critical" : "warning", text: `ROAS at ${roas.toFixed(1)}× — below the 4× target. Primary driver: ${mainDriver}.` })
    }
  }

  return insights
}

function generateProposals(insights: Insight[], m: MondayTargetsData, meta: MetaTargetsData, t: TargetsConfig, range: DateRange): string[] {
  const proposals: string[] = []
  const spend = meta.spend
  const calls = m.calls
  const qualified = m.qualifiedCalls
  const taken = m.takenCalls
  const deals = m.deals
  const revenue = m.closedRevenue
  const cbc = safeDivide(spend, calls)
  const cpd = safeDivide(spend, deals)
  const showUpRate = safeDivide(taken, qualified)
  const roas = safeDivide(revenue, spend)
  const avgDealValue = deals > 0 ? revenue / deals : 0
  const expectedDealValue = t.deals > 0 && t.revenue > 0 ? t.revenue / t.deals : 0
  const prCalls = t.calls ? Math.round(proRata(t.calls, range)) : 0
  const noShows = qualified - taken

  const hasSpendIssue = insights.some((i) => i.text.includes("too low"))
  const hasNoShowIssue = insights.some((i) => i.text.includes("no-shows"))
  const hasCostIssue = insights.some((i) => i.text.includes("Creatives need a refresh"))
  const hasDealValueIssue = insights.some((i) => i.text.includes("Avg deal value"))
  const hasRoasIssue = insights.some((i) => i.text.includes("ROAS") && i.type !== "positive")
  const isCompensated = insights.some((i) => i.text.includes("No action needed on costs"))

  if (hasSpendIssue) {
    const neededSpend = t.cbc * prCalls
    proposals.push(`Scale ad spend from ${formatCurrencyDecimal(spend)} to ~${formatCurrencyDecimal(neededSpend)}. Efficiency is proven (CBC ${formatCurrencyDecimal(cbc)}) — the only thing between us and ${prCalls} booked calls is budget.`)
  }

  if (hasNoShowIssue) {
    proposals.push(`${noShows} qualified leads didn't show up (${formatPercent(showUpRate)} show-up vs 80% target). WhatsApp reminders are already in place — audit their delivery and timing. Consider adding a personal confirmation call or SMS 2h before the appointment.`)
  }

  if (hasCostIssue) {
    proposals.push(`Cost per acquisition is above target across the funnel. Launch 3-5 new creative variations this week — iterate on the best performing angle with fresh hooks and B-roll.`)
  }

  if (isCompensated) {
    proposals.push(`Front-of-funnel costs are elevated but the strong show-up rate keeps CTC on track. No creative changes needed — protect the show-up rate as the key lever.`)
  }

  if (hasDealValueIssue) {
    proposals.push(`Revenue gap is driven by deal value (${formatCurrency(avgDealValue)} vs ${formatCurrency(expectedDealValue)} expected), not deal volume. Steer sales towards HTO packages or review discount practices to close the gap.`)
  }

  if (hasRoasIssue && !hasDealValueIssue && !hasCostIssue) {
    proposals.push(`ROAS is ${roas.toFixed(1)}× (target: 4×). With CPD at ${formatCurrencyDecimal(cpd)} and deal value at ${formatCurrency(avgDealValue)}, the fastest fix is improving creative performance to bring CPD down.`)
  }

  if (insights.every((i) => i.type === "positive")) {
    proposals.push("All metrics are on track. Iterate on winning creatives — same direction, fresh executions to stay ahead of ad fatigue.")
    proposals.push("Test a secondary marketing angle alongside the winner to build pipeline diversification for next month.")
  }

  if (proposals.length === 0) {
    proposals.push("No immediate action required. Continue monitoring funnel performance.")
  }

  return proposals
}

export const MarketingInsights = memo(function MarketingInsights({ monday, meta, targets, range, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-card rounded-lg p-4 border border-border/40">
          <Skeleton className="h-4 w-32 mb-3" />
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border/40">
          <Skeleton className="h-4 w-40 mb-3" />
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        </div>
      </div>
    )
  }

  if (!monday || !meta || !targets) {
    return null
  }

  const insights = generateInsights(monday, meta, targets, range)
  const proposals = generateProposals(insights, monday, meta, targets, range)

  const dotColor = (type: Insight["type"]) =>
    type === "positive" ? "bg-green-500" : type === "warning" ? "bg-yellow-500" : "bg-red-500"

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Key Insights */}
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Key Insights</h3>
        </div>
        <div className="space-y-2">
          {insights.map((insight, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${dotColor(insight.type)}`} />
              <span className="text-xs text-foreground/90 leading-relaxed">{insight.text}</span>
            </div>
          ))}
          {insights.length === 0 && (
            <span className="text-xs text-muted-foreground">Set targets in Settings to enable insights.</span>
          )}
        </div>
      </div>

      {/* Optimisation Proposal */}
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Optimisation Proposal</h3>
        </div>
        <div className="space-y-2">
          {proposals.map((proposal, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-xs text-muted-foreground/60 font-mono shrink-0">{i + 1}.</span>
              <span className="text-xs text-foreground/90 leading-relaxed">{proposal}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
