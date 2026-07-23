"use client"

import { memo } from "react"
import { startOfMonth, differenceInDays, getDaysInMonth, max as dateMax } from "date-fns"
import { AlertCircle, AlertOctagon, CheckCircle2, Lightbulb, TrendingUp } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatCurrencyDecimal, formatMultiplier, formatPercent, safeDivide } from "@/lib/targets/formatters"
import { deriveTargets } from "@/lib/targets/calculations"
import type { MondayTargetsData, MetaTargetsData, TargetsConfig, DateRange } from "@/types/targets"

const STATUS_ICON: Record<"positive" | "warning" | "critical", { icon: LucideIcon; color: string }> = {
  positive: { icon: CheckCircle2, color: "text-green-500" },
  warning: { icon: AlertCircle, color: "text-yellow-500" },
  critical: { icon: AlertOctagon, color: "text-red-500" },
}

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

interface Insight {
  type: "positive" | "warning" | "critical"
  text: string
}

// ─── The 4 root-cause pillars ───────────────────────────────────────────────
// 1. CBC (creatives, targeting, ad testing)
// 2. Booking Rate (Booked / Opt-ins - funnel conversion at the top)
// 3. Show-up Rate (Taken / Booked - reminders, lead warmth, scheduling)
// 4. Conversion Rate (sales quality, proposition, closability)
//
// CPD and ROAS are OUTCOMES of these 4. Never cite CPD/ROAS as a root cause.
// Qualification Rate was dropped 2026-05-27 along with the qualification stage.

interface PillarStatus {
  name: string
  onTrack: boolean
  value: string
  target: string
}

function generateInsights(
  m: MondayTargetsData,
  meta: MetaTargetsData,
  t: TargetsConfig,
  range: DateRange,
): Insight[] {
  const insights: Insight[] = []
  const spend = meta.spend
  const optIns = m.optIns
  const calls = m.calls
  const taken = m.takenCalls
  const deals = m.deals
  const revenue = m.closedRevenue

  const derived = deriveTargets(t)
  const prCalls = Math.round(proRata(derived.calls, range))
  const prDeals = Math.round(proRata(t.deals, range))

  const cbc = safeDivide(spend, calls)
  // 2026-05-27: pillars switched - qualification gone, booking rate
  // (booked / opt-ins) takes its place; show-up uses booked as denominator.
  const bookingRate = safeDivide(calls, optIns)
  const showUpRate = safeDivide(taken, calls)
  const conversionRate = safeDivide(deals, taken)
  const roas = safeDivide(revenue, spend)
  const avgDealValue = deals > 0 ? revenue / deals : 0
  const expectedDealValue = t.deals > 0 && t.revenue > 0 ? t.revenue / t.deals : 0
  const callsOnTrack = prCalls > 0 && calls >= prCalls

  // Ratio targets derived from the cost ladder (cbc / ctc / cpd) + cpOptIn
  const bookingRateTarget = derived.bookingRate
  const showUpRateTarget = derived.showUpRate
  const convRateTarget = derived.convRate
  const roasTarget = derived.roas

  // Evaluate the 4 pillars (a pillar with no target is treated as on-track / skipped)
  const cbcOnTrack = t.cbc > 0 ? cbc <= t.cbc : true
  const bookingOnTrack = optIns > 3 && bookingRateTarget > 0 ? bookingRate >= bookingRateTarget : true
  const showUpOnTrack = calls > 3 && showUpRateTarget > 0 ? showUpRate >= showUpRateTarget : true
  const convOnTrack = taken > 3 && convRateTarget > 0 ? conversionRate >= convRateTarget : true

  const pillars: PillarStatus[] = [
    { name: "CBC", onTrack: cbcOnTrack, value: formatCurrencyDecimal(cbc), target: t.cbc > 0 ? formatCurrencyDecimal(t.cbc) : "-" },
    { name: "Booking Rate", onTrack: bookingOnTrack, value: formatPercent(bookingRate), target: bookingRateTarget > 0 ? formatPercent(bookingRateTarget) : "-" },
    { name: "Show-up Rate", onTrack: showUpOnTrack, value: formatPercent(showUpRate), target: showUpRateTarget > 0 ? formatPercent(showUpRateTarget) : "-" },
    { name: "Conversion Rate", onTrack: convOnTrack, value: formatPercent(conversionRate), target: convRateTarget > 0 ? formatPercent(convRateTarget) : "-" },
  ]

  const offTrack = pillars.filter((p) => !p.onTrack)
  const onTrack = pillars.filter((p) => p.onTrack)

  // ── Combined pillar insight ──
  if (offTrack.length === 0) {
    insights.push({
      type: "positive",
      text: `All 4 pillars on track: ${onTrack.map((p) => `${p.name} (${p.value})`).join(", ")}. Funnel is healthy.`,
    })
  } else if (offTrack.length <= 2) {
    const offStr = offTrack.map((p) => `${p.name} at ${p.value} (target: ${p.target})`).join(" and ")
    const onStr = onTrack.map((p) => `${p.name} (${p.value})`).join(", ")
    insights.push({
      type: "warning",
      text: `${offStr} ${offTrack.length === 1 ? "is" : "are"} off track. ${onTrack.length > 0 ? `On track: ${onStr}.` : ""}`,
    })
  } else {
    const offStr = offTrack.map((p) => `${p.name} ${p.value}`).join(", ")
    insights.push({
      type: "critical",
      text: `${offTrack.length} of 4 pillars off track (${offStr}). Funnel needs attention across multiple stages.`,
    })
  }

  // ── Ad spend diagnostic (only when CBC is fine but volume is behind) ──
  if (cbcOnTrack && !callsOnTrack && prCalls > 0) {
    const neededSpend = t.cbc * prCalls
    insights.push({
      type: "warning",
      text: `CBC is efficient (${formatCurrencyDecimal(cbc)}) but booked calls are behind (${calls}/${prCalls}). Ad spend of ${formatCurrencyDecimal(spend)} is the bottleneck - need ~${formatCurrencyDecimal(neededSpend)} at current efficiency.`,
    })
  }

  // ── Deal value misalignment ──
  if (deals > 0 && expectedDealValue > 0 && avgDealValue < expectedDealValue * 0.8) {
    insights.push({
      type: "warning",
      text: `Avg deal value is ${formatCurrency(avgDealValue)} vs ${formatCurrency(expectedDealValue)} expected. Even at ${t.deals} deals/month, revenue would only reach ~${formatCurrency(t.deals * avgDealValue)} - below the ${formatCurrency(t.revenue)} target.`,
    })
  }

  // ── ROAS - trace back to pillars, never cite CPD as root cause ──
  if (spend > 0 && deals > 0 && roasTarget > 0) {
    const roasTargetStr = formatMultiplier(roasTarget)
    if (roas >= roasTarget) {
      insights.push({ type: "positive", text: `ROAS at ${roas.toFixed(1)}× (target: ${roasTargetStr}).` })
    } else {
      // Find the root causes from the 4 pillars
      const rootCauses = offTrack.map((p) => p.name)
      const rootStr = rootCauses.length > 0
        ? `Driven by: ${rootCauses.join(", ").toLowerCase()}.`
        : avgDealValue < expectedDealValue * 0.8
        ? "Driven by: low avg deal value."
        : "Review all 4 funnel pillars."
      const isCritical = roas < roasTarget * 0.75
      insights.push({ type: isCritical ? "critical" : "warning", text: `ROAS at ${roas.toFixed(1)}× - below the ${roasTargetStr} target. ${rootStr}` })
    }
  }

  return insights
}

function generateProposals(insights: Insight[], m: MondayTargetsData, meta: MetaTargetsData, t: TargetsConfig, range: DateRange): string[] {
  const proposals: string[] = []
  const spend = meta.spend
  const optIns = m.optIns
  const calls = m.calls
  const taken = m.takenCalls
  const deals = m.deals
  const revenue = m.closedRevenue
  // Coalesce to 0: a cache written before these fields existed serves them as
  // undefined, which turned the drop-off line into "NaN … undefined cancellations".
  const noShows = m.noShows ?? 0
  const cancellations = m.cancellations ?? 0
  const cbc = safeDivide(spend, calls)
  const bookingRate = safeDivide(calls, optIns)
  const showUpRate = safeDivide(taken, calls)
  const conversionRate = safeDivide(deals, taken)
  const avgDealValue = deals > 0 ? revenue / deals : 0
  const expectedDealValue = t.deals > 0 && t.revenue > 0 ? t.revenue / t.deals : 0
  const derived = deriveTargets(t)
  const prCalls = derived.calls > 0 ? Math.round(proRata(derived.calls, range)) : 0

  // Ratio targets derived from the cost ladder + cpOptIn
  const bookingRateTarget = derived.bookingRate
  const showUpRateTarget = derived.showUpRate
  const convRateTarget = derived.convRate

  const cbcOffTrack = t.cbc > 0 && cbc > t.cbc
  const bookingOffTrack = optIns > 3 && bookingRateTarget > 0 && bookingRate < bookingRateTarget
  const showUpOffTrack = calls > 3 && showUpRateTarget > 0 && showUpRate < showUpRateTarget
  const convOffTrack = taken > 3 && convRateTarget > 0 && conversionRate < convRateTarget
  const spendIssue = !cbcOffTrack && prCalls > 0 && calls < prCalls
  const dealValueIssue = deals > 0 && expectedDealValue > 0 && avgDealValue < expectedDealValue * 0.8

  // ── Pillar 1: CBC ──
  if (cbcOffTrack) {
    proposals.push(`CBC is ${formatCurrencyDecimal(cbc)} (target: ${formatCurrencyDecimal(t.cbc)}). Iterate on creatives - test new hooks, angles, and formats. Focus on the top-performing ad direction and create 3-5 fresh variations.`)
  }

  // ── Spend issue (CBC fine but volume behind) ──
  if (spendIssue) {
    const neededSpend = t.cbc * prCalls
    proposals.push(`Scale ad spend from ${formatCurrencyDecimal(spend)} to ~${formatCurrencyDecimal(neededSpend)}. CBC is proven at ${formatCurrencyDecimal(cbc)} - the only gap between ${calls} and ${prCalls} booked calls is budget.`)
  }

  // ── Pillar 2: Booking Rate (Booked / Opt-ins) ──
  if (bookingOffTrack) {
    proposals.push(`Booking rate is ${formatPercent(bookingRate)} - only ${calls} of ${optIns} opt-ins booked a call (target: ${formatPercent(bookingRateTarget)}). The opt-in → booked dropoff is the bottleneck. Check the calendar flow (friction, available slots), follow-up timing on opt-ins who didn't book, and whether the form-to-calendar handoff is smooth.`)
  }

  // ── Pillar 3: Show-up Rate (Taken / Booked) ──
  if (showUpOffTrack) {
    const dropOff = noShows + cancellations
    proposals.push(`Show-up rate is ${formatPercent(showUpRate)} - ${dropOff} booked calls didn't happen (${noShows} no-show${noShows === 1 ? "" : "s"}, ${cancellations} cancellation${cancellations === 1 ? "" : "s"}). WhatsApp reminders are already active - audit their delivery timing and open rates. Consider a personal confirmation call 2h before the appointment, and check if leads can book too far ahead (reducing urgency).`)
  }

  // ── Pillar 4: Conversion Rate ──
  if (convOffTrack) {
    proposals.push(`Conversion rate is ${formatPercent(conversionRate)} (target: ${formatPercent(convRateTarget)}) - ${taken} taken calls resulted in only ${deals} deals. Review: are leads ICP-fit and closeable? Is the sales proposition strong enough? Evaluate the sales team's close technique and whether pricing/packaging needs adjustment.`)
  }

  // ── Deal value issue ──
  if (dealValueIssue) {
    proposals.push(`Avg deal value is ${formatCurrency(avgDealValue)} vs ${formatCurrency(expectedDealValue)} expected. Revenue target can't be hit on volume alone. Steer sales towards HTO packages or review discounting practices.`)
  }

  // ── Everything on track ──
  if (!cbcOffTrack && !bookingOffTrack && !showUpOffTrack && !convOffTrack && !spendIssue && !dealValueIssue) {
    proposals.push("All 4 pillars and deal value are on track. Iterate on winning creatives - same direction, fresh executions to stay ahead of ad fatigue.")
    proposals.push("Test a secondary marketing angle alongside the winner to build pipeline diversification for next month.")
  }

  return proposals
}

export const MarketingInsights = memo(function MarketingInsights({ monday, meta, targets, range, isLoading }: Props) {
  if (isLoading || !monday || !meta || !targets) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, idx) => (
          <div key={idx} className="bg-card rounded-lg p-5 border border-border/40">
            <Skeleton className="h-4 w-32 mb-4" />
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
          </div>
        ))}
      </div>
    )
  }

  const insights = generateInsights(monday, meta, targets, range)
  const proposals = generateProposals(insights, monday, meta, targets, range)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Key Insights */}
      <div className="bg-card rounded-lg p-5 border border-border/40">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Key Insights</h3>
        </div>
        <div className="space-y-3">
          {insights.map((insight, i) => {
            const { icon: Icon, color } = STATUS_ICON[insight.type]
            return (
              <div key={i} className="flex items-start gap-2.5">
                <Icon className={`h-4 w-4 shrink-0 mt-px ${color}`} strokeWidth={2.25} />
                <p className="text-sm text-foreground leading-relaxed">{insight.text}</p>
              </div>
            )
          })}
          {insights.length === 0 && (
            <p className="text-sm text-muted-foreground leading-relaxed">Set targets in Settings to enable insights.</p>
          )}
        </div>
      </div>

      {/* Optimisation Proposal */}
      <div className="bg-card rounded-lg p-5 border border-border/40">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Optimisation Proposal</h3>
        </div>
        <div className="space-y-3">
          {proposals.map((proposal, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="text-xs font-mono font-medium text-muted-foreground/60 shrink-0 mt-[3px] tabular-nums w-5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="text-sm text-foreground leading-relaxed">{proposal}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
